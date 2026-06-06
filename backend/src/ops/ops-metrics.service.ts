import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataFreshnessService } from '../cron-health/data-freshness.service';
import { GraduationMetricsService } from '../engine5-trading-risk/simulation/graduation-metrics.service';
import { buildGraduationReport } from '../engine5-trading-risk/simulation/domain/graduation-gates';
import {
  CollectionFreshnessSummary,
  GraduationGateSummary,
  OpsMetrics,
} from './ops-metrics.types';

/** 메트릭에 노출할 졸업 게이트(졸업지표 핵심 4종). */
const EXPOSED_GATE_IDS = ['G1', 'G2', 'G3', 'G5'];

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * OpsMetricsService (DAR-111) — 경량 JSON 운영 메트릭 집계.
 *
 * 핵심 카운터: AIUsageLog 누적·최근 신호 수·모의 포지션 수·마지막 수집 시각
 * (DAR-110 freshness 연계)·졸업지표 G1/G2/G3/G5 현재값·표본수.
 *
 * ★ read-only — 신규 수집·외부호출·체결·AI 개입 0. 마이그레이션 0.
 *   freshness/졸업 산출은 graceful(실패 시 null) — 메트릭 본체(카운터)는 항상 반환.
 *   ★실주문/Kill Switch 무직결(운영 관측 전용).
 */
@Injectable()
export class OpsMetricsService {
  private readonly logger = new Logger(OpsMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly freshness: DataFreshnessService,
    private readonly graduation: GraduationMetricsService,
  ) {}

  /** 운영 메트릭 스냅샷. `now` 주입 가능(테스트 결정론). */
  async getMetrics(now: Date = new Date()): Promise<OpsMetrics> {
    const since24h = new Date(now.getTime() - MS_PER_DAY);
    const since7d = new Date(now.getTime() - 7 * MS_PER_DAY);

    const [aiAgg, signals24h, signals7d, signalsTotal, positions, collection, graduation] =
      await Promise.all([
        this.prisma.aIUsageLog.aggregate({
          _count: { _all: true },
          _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        }),
        this.prisma.tradingSignal.count({ where: { createdAt: { gte: since24h } } }),
        this.prisma.tradingSignal.count({ where: { createdAt: { gte: since7d } } }),
        this.prisma.tradingSignal.count(),
        this.prisma.position.groupBy({ by: ['status'], _count: { _all: true } }),
        this.buildCollectionSummary(now),
        this.buildGraduationSummary(),
      ]);

    // 모의 포지션 — 실주문 모듈(M11/M12) 미구축이라 전 포지션이 모의 포지션.
    const openCount = this.sumStatus(positions, ['OPEN']);
    const closedCount = this.sumStatus(positions, ['CLOSED']);
    const totalCount = positions.reduce((s, r) => s + (r._count?._all ?? 0), 0);

    return {
      generatedAt: now.toISOString(),
      aiUsage: {
        totalCalls: aiAgg._count?._all ?? 0,
        totalCostUsd: aiAgg._sum?.costUsd ?? 0,
        totalInputTokens: aiAgg._sum?.inputTokens ?? 0,
        totalOutputTokens: aiAgg._sum?.outputTokens ?? 0,
      },
      signals: {
        last24h: signals24h,
        last7d: signals7d,
        total: signalsTotal,
      },
      simulationPositions: {
        open: openCount,
        closed: closedCount,
        total: totalCount,
      },
      collection,
      graduation,
    };
  }

  private sumStatus(
    rows: Array<{ status: string; _count: { _all: number } }>,
    statuses: string[],
  ): number {
    return rows
      .filter((r) => statuses.includes(r.status))
      .reduce((s, r) => s + (r._count?._all ?? 0), 0);
  }

  /**
   * DAR-110 freshness 연계 — 마지막 수집 시각·정체 여부 경량 요약.
   * 집계 실패 시 null(graceful) — 메트릭 본체는 카운터로 계속 동작.
   */
  private async buildCollectionSummary(
    now: Date,
  ): Promise<CollectionFreshnessSummary | null> {
    try {
      const report = await this.freshness.getFreshness(now);
      return {
        anyStale: report.anyStale,
        staleJobs: report.staleJobs,
        jobs: report.jobs.map((j) => ({
          jobKey: j.jobKey,
          lastSuccessAt: j.lastSuccessAt,
          isStale: j.isStale,
          ageMinutes: j.ageMinutes,
        })),
      };
    } catch (err) {
      this.logger.warn(
        `freshness 집계 실패(graceful, null 노출): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 졸업지표 G1/G2/G3/G5 현재값·표본수. 데이터 부족/산출 실패 시 null(graceful).
   * ★과신 방지: 측정 불가·표본 부족 게이트는 currentValue/pass=null 정직 표기(buildGraduationReport 계승).
   */
  private async buildGraduationSummary(): Promise<GraduationGateSummary[] | null> {
    try {
      const metrics = await this.graduation.getMetrics();
      const report = buildGraduationReport(metrics);
      return report.gates
        .filter((g) => EXPOSED_GATE_IDS.includes(g.id))
        .map((g) => ({
          id: g.id,
          label: g.label,
          currentValue: g.currentValue,
          threshold: g.threshold,
          pass: g.pass,
          sampleSize: g.sampleSize,
        }));
    } catch (err) {
      this.logger.warn(
        `졸업지표 집계 실패(graceful, null 노출): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
