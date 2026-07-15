import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFreshnessReport,
  FreshnessJobInput,
  FreshnessJobSpec,
  FreshnessReport,
  RecentSuccessRun,
} from './freshness';
import { FRESHNESS_JOB_SPECS } from './cron-health.jobs';

// 도메인 로그에서 '성공'으로 칠 상태(PARTIAL 도 데이터는 적재됨 → 성공 취급).
const SUCCESS_STATES = ['SUCCESS', 'PARTIAL'];

/** 잡별 조회 결과의 공통 형태. */
interface LastRun {
  lastSuccessAt: Date | null;
  lastStatus: string | null;
  lastItemCount: number | null;
}

/**
 * DataFreshnessService (DAR-110) — 수집 안전망의 read-only 신선도 집계.
 *
 * CronRunLog(경량 크론) + 도메인 *CollectionLog(공시·시세·재무)에서 잡별
 * 마지막 성공시각/건수를 모아 순수 판정 함수(buildFreshnessReport)에 넘긴다.
 * 신규 수집·외부호출·AI 없음 — 기존 테이블 조회만.
 */
@Injectable()
export class DataFreshnessService {
  constructor(private readonly prisma: PrismaService) {}

  /** 전체 신선도 리포트. `now` 주입 가능(테스트 결정론). */
  async getFreshness(now: Date = new Date()): Promise<FreshnessReport> {
    const inputs = await Promise.all(
      FRESHNESS_JOB_SPECS.map((spec) => this.buildInput(spec)),
    );
    return buildFreshnessReport(inputs, now);
  }

  private async buildInput(
    spec: FreshnessJobSpec,
  ): Promise<FreshnessJobInput> {
    const [run, recentRuns] = await Promise.all([
      this.lastRunForSource(spec),
      this.recentRunsForZeroRun(spec),
    ]);
    return { spec, ...run, recentRuns };
  }

  /**
   * [W11] 제로런 축 입력 — zeroRunThreshold 부여 잡만 최근 성공 실행 N건(최신순)을 조회.
   * 판정(당일 경계·연속 카운트·장중 게이트)은 순수 함수(freshness.ts)가 담당한다.
   * 인덱스 커버 소량 조회(take≤임계)라 read-only 부하 미미.
   */
  private async recentRunsForZeroRun(
    spec: FreshnessJobSpec,
  ): Promise<RecentSuccessRun[] | undefined> {
    const take = spec.zeroRunThreshold;
    if (take == null || take <= 0) return undefined;

    if (spec.source === 'CRON_RUN_LOG') {
      const rows = await this.prisma.cronRunLog.findMany({
        where: { jobKey: spec.jobKey, status: 'SUCCESS' },
        orderBy: { finishedAt: 'desc' },
        take,
        select: { finishedAt: true, itemCount: true },
      });
      return rows
        .filter((r): r is { finishedAt: Date; itemCount: number } => r.finishedAt != null)
        .map((r) => ({ finishedAt: r.finishedAt, itemCount: r.itemCount }));
    }

    if (spec.source === 'DISCLOSURE_LOG') {
      const rows = await this.prisma.disclosureCollectionLog.findMany({
        where: { status: { in: SUCCESS_STATES } },
        orderBy: { startedAt: 'desc' },
        take,
        select: { endedAt: true, startedAt: true, newCount: true },
      });
      return rows.map((r) => ({
        finishedAt: r.endedAt ?? r.startedAt,
        itemCount: r.newCount ?? null,
      }));
    }

    // MARKET/FINANCIAL 은 제로런 대상 잡이 없다(일 단위 EOD — 장중 산출 기대 없음).
    return undefined;
  }

  private async lastRunForSource(spec: FreshnessJobSpec): Promise<LastRun> {
    switch (spec.source) {
      case 'CRON_RUN_LOG':
        return this.lastCronRun(spec.jobKey);
      case 'DISCLOSURE_LOG':
        return this.lastDisclosureRun();
      case 'MARKET_DATA_LOG':
        return this.lastMarketDataRun();
      case 'FINANCIAL_LOG':
        return this.lastFinancialRun();
      default:
        // 도달 불가(타입 망라). 안전 폴백.
        return { lastSuccessAt: null, lastStatus: null, lastItemCount: null };
    }
  }

  private async lastCronRun(jobKey: string): Promise<LastRun> {
    const [lastSuccess, lastAny] = await Promise.all([
      this.prisma.cronRunLog.findFirst({
        where: { jobKey, status: 'SUCCESS' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true, itemCount: true },
      }),
      this.prisma.cronRunLog.findFirst({
        where: { jobKey },
        orderBy: { startedAt: 'desc' },
        select: { status: true },
      }),
    ]);
    return {
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      lastStatus: lastAny?.status ?? null,
      lastItemCount: lastSuccess?.itemCount ?? null,
    };
  }

  private async lastDisclosureRun(): Promise<LastRun> {
    const [lastSuccess, lastAny] = await Promise.all([
      this.prisma.disclosureCollectionLog.findFirst({
        where: { status: { in: SUCCESS_STATES } },
        orderBy: { startedAt: 'desc' },
        select: { endedAt: true, startedAt: true, newCount: true },
      }),
      this.prisma.disclosureCollectionLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { status: true },
      }),
    ]);
    return {
      lastSuccessAt: lastSuccess?.endedAt ?? lastSuccess?.startedAt ?? null,
      lastStatus: lastAny?.status ?? null,
      lastItemCount: lastSuccess?.newCount ?? null,
    };
  }

  private async lastMarketDataRun(): Promise<LastRun> {
    const [lastSuccess, lastAny] = await Promise.all([
      this.prisma.marketDataCollectionLog.findFirst({
        where: { status: { in: SUCCESS_STATES } },
        orderBy: { startedAt: 'desc' },
        select: { endedAt: true, startedAt: true, savedCount: true },
      }),
      this.prisma.marketDataCollectionLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { status: true },
      }),
    ]);
    return {
      lastSuccessAt: lastSuccess?.endedAt ?? lastSuccess?.startedAt ?? null,
      lastStatus: lastAny?.status ?? null,
      lastItemCount: lastSuccess?.savedCount ?? null,
    };
  }

  private async lastFinancialRun(): Promise<LastRun> {
    const [lastSuccess, lastAny] = await Promise.all([
      this.prisma.financialCollectionLog.findFirst({
        where: { status: { in: SUCCESS_STATES } },
        orderBy: { startedAt: 'desc' },
        select: { endedAt: true, startedAt: true, savedCount: true },
      }),
      this.prisma.financialCollectionLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { status: true },
      }),
    ]);
    return {
      lastSuccessAt: lastSuccess?.endedAt ?? lastSuccess?.startedAt ?? null,
      lastStatus: lastAny?.status ?? null,
      lastItemCount: lastSuccess?.savedCount ?? null,
    };
  }
}
