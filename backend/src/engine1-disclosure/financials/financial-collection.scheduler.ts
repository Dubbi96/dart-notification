import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FinancialCollectionService,
  BackfillTimeSeriesResult,
} from './financial-collection.service';

/**
 * 재무지표 정기 수집 스케줄러 (DAR-55).
 *
 * 1) 주간 전종목 벌크 수집 (scope:'ALL', 분기 시계열 11011~11014).
 * 2) 실적시즌(3·5·8·11월) 평일 가중 수집.
 * 3) 정기보고서(REGULAR) 공시 EVENT 트리거 재수집 — 신규 정기공시 종목만.
 *
 * 공시 수집 스케줄러(SchedulerService)와 별개 큐/락이라 충돌 없음.
 * 자연키 멱등이라 모든 크론 재실행이 무손상. AI 미개입(순수 재무·Rule).
 */
@Injectable()
export class FinancialCollectionScheduler {
  private readonly logger = new Logger(FinancialCollectionScheduler.name);
  private isRunning = false;
  /** 마지막 EVENT 스캔 시각 — 중복 재수집 방지(이후 신규 정기공시만). */
  private lastEventScanAt: Date | null = null;

  /** 실적시즌 — 정기보고서 마감월: 3월(사업), 5월(1Q), 8월(반기), 11월(3Q). */
  private static readonly EARNINGS_SEASON_MONTHS = new Set([3, 5, 8, 11]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collection: FinancialCollectionService,
  ) {}

  /**
   * 주간 전종목 벌크 수집 — 매주 월요일 04:00 (장 시작 전, 저호출 시간대).
   * scope:'ALL' + 분기 시계열 전체. 대량 호출이라 주 1회로 제한.
   */
  @Cron('0 4 * * 1')
  async weeklyBulkCollect(): Promise<BackfillTimeSeriesResult | { skipped: true; reason: string }> {
    return this.runBulk('CRON');
  }

  /**
   * 실적시즌 가중 수집 — 평일 05:00, 단 마감월(3·5·8·11)에만 실행.
   * 신규 정기보고서가 몰리는 시기에 일 단위로 최신 재무를 빠르게 반영.
   */
  @Cron('0 5 * * 1-5')
  async earningsSeasonCollect(
    now: Date = new Date(),
  ): Promise<BackfillTimeSeriesResult | { skipped: true; reason: string }> {
    if (!this.isEarningsSeason(now)) {
      return { skipped: true, reason: '실적시즌(3·5·8·11월) 아님' };
    }
    return this.runBulk('CRON', now);
  }

  /**
   * 정기보고서 공시 EVENT 재수집 — 6시간 간격으로 신규 REGULAR 공시 종목을 분기 백필.
   * 정기보고서(사업·반기·분기) 발생 시 해당 종목 재무를 즉시 갱신한다.
   */
  @Cron('0 */6 * * *')
  async periodicReportEvent(
    now: Date = new Date(),
  ): Promise<
    | BackfillTimeSeriesResult
    | { skipped: true; reason: string }
  > {
    if (this.isRunning) {
      this.logger.warn('재무 수집 진행 중 — EVENT 재수집 건너뜀');
      return { skipped: true, reason: '이전 수집 진행 중' };
    }

    const since = this.lastEventScanAt ?? new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const recent = await this.prisma.disclosure.findMany({
      where: { disclosureType: 'REGULAR', createdAt: { gte: since } },
      distinct: ['corpCode'],
      select: { corpCode: true },
    });
    this.lastEventScanAt = now;

    const corpCodes = recent.map((d) => d.corpCode).filter(Boolean);
    if (corpCodes.length === 0) {
      return { skipped: true, reason: '신규 정기보고서 공시 없음' };
    }

    this.isRunning = true;
    try {
      this.logger.log(`정기보고서 EVENT 재수집 — ${corpCodes.length}개 종목`);
      // 당해·전년 분기 시계열 백필 (자연키 멱등).
      const year = now.getFullYear();
      return await this.collection.backfillTimeSeries({
        bsnsYears: [String(year), String(year - 1)],
        corpCodes,
        triggeredBy: 'EVENT',
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 전종목 벌크 수집 공통 경로 — 단일 실행 락. 당해/직전 사업연도 분기 시계열.
   */
  private async runBulk(
    triggeredBy: 'CRON' | 'MANUAL' | 'EVENT',
    now: Date = new Date(),
  ): Promise<BackfillTimeSeriesResult | { skipped: true; reason: string }> {
    if (this.isRunning) {
      this.logger.warn('이전 재무 수집 진행 중 — 벌크 수집 건너뜀');
      return { skipped: true, reason: '이전 수집 진행 중' };
    }

    this.isRunning = true;
    try {
      const bsnsYear = String(this.resolveBsnsYear(now));
      this.logger.log(`전종목 재무 벌크 수집 시작 (bsnsYear=${bsnsYear}, scope=ALL)`);
      return await this.collection.backfillTimeSeries({
        bsnsYears: [bsnsYear],
        scope: 'ALL',
        triggeredBy,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /** 마감월 기준 수집 대상 사업연도 — 정기보고서가 직전 회계연도/분기 기준이므로 전년도 우선. */
  private resolveBsnsYear(now: Date): number {
    // 사업보고서는 직전 연도 마감(3월 제출) → 안정적으로 전년도를 대상으로 잡는다.
    return now.getFullYear() - 1;
  }

  private isEarningsSeason(now: Date): boolean {
    return FinancialCollectionScheduler.EARNINGS_SEASON_MONTHS.has(now.getMonth() + 1);
  }
}
