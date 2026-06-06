import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFreshnessReport,
  FreshnessJobInput,
  FreshnessJobSpec,
  FreshnessReport,
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
    const run = await this.lastRunForSource(spec);
    return { spec, ...run };
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
