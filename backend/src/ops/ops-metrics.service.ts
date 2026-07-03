import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataFreshnessService } from '../cron-health/data-freshness.service';
import { GraduationMetricsService } from '../engine5-trading-risk/simulation/graduation-metrics.service';
import { buildGraduationReport } from '../engine5-trading-risk/simulation/domain/graduation-gates';
import { PipelineIntegrityService } from '../engine1-disclosure/pipeline/pipeline-integrity.service';
import { PipelineHealth } from '../engine1-disclosure/pipeline/pipeline.types';
import {
  CollectionFreshnessSummary,
  GraduationGateSummary,
  OpsMetrics,
  SlippageDistribution,
  SlippageSummary,
  SlippageTrackDistribution,
} from './ops-metrics.types';

/** 메트릭에 노출할 졸업 게이트(졸업지표 핵심 4종). */
const EXPOSED_GATE_IDS = ['G1', 'G2', 'G3', 'G5'];

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** styleTag 미부여(placeOrder 경로 매도 등) 행의 집계 버킷 라벨. */
const UNTAGGED_TRACK = '(untagged)';

/** 슬리피지 부호 기준 100% = 10000 bps. */
const BPS_SCALE = 10000;

/** 산술평균 — 표본 0이면 null(graceful). */
function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 백분위(nearest-rank, 결정론) — 표본 0이면 null. p∈[0,1]. */
function percentileOrNull(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length); // 1-indexed
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

/** 소수 digits 자리 반올림(부동소수 잡음 제거). null 보존. */
function roundOrNull(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 트랙별 슬리피지 원시 누적기(내부 전용). */
interface SlippageAccumulator {
  count: number;
  /** 거래별 슬리피지 원가(KRW). */
  slippageKrw: number[];
  /** 수수료+세금 합(KRW) — 슬리피지와 구분. */
  feesKrw: number;
  /** 거래별 신호시점 기대가 대비 실현 슬리피지(bps). */
  bps: number[];
}

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
    // DAR-126: 파이프라인 단계 카운트 재사용. @Optional — 미배선 시 pipeline=null(graceful).
    @Optional() private readonly pipeline?: PipelineIntegrityService,
  ) {}

  /** 운영 메트릭 스냅샷. `now` 주입 가능(테스트 결정론). */
  async getMetrics(now: Date = new Date()): Promise<OpsMetrics> {
    const since24h = new Date(now.getTime() - MS_PER_DAY);
    const since7d = new Date(now.getTime() - 7 * MS_PER_DAY);

    const [
      aiAgg,
      signals24h,
      signals7d,
      signalsTotal,
      positions,
      collection,
      graduation,
      pipeline,
      slippage,
    ] = await Promise.all([
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
      this.buildPipelineSummary(now),
      this.buildSlippageSummary(),
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
      pipeline,
      slippage,
    };
  }

  /**
   * DAR-474 — 슬리피지 분포 집계(read-only). PaperTrade(시스템 모의·전략 4종·철학 4종)의 체결
   * 거래 + IntradayScalpTrade(분봉 단타) 청산 거래를 트랙(styleTag)별로 묶어 평균·p95를 산출한다.
   *
   *  · KRW: 체결 시 기록된 `slippage` 원가 절대값(트랙별·전체 평균/p95).
   *  · bps: 신호시점 기대가(`expectedPrice`, 없으면 `entryPrice` 폴백) 대비 실현 슬리피지 —
   *    실전 전환 게이트("슬리피지 기대 이내") 소비 지표. expectedPrice 보존분만 산정(레거시=제외).
   *  · totalFees(수수료+세금)는 슬리피지와 **구분 유지**(단타 totalFees SSOT 정합).
   *
   * ★read-only — 체결·주문·AI 개입 0. 집계 실패 시 null(graceful) — 카운터 본체는 계속 동작.
   */
  private async buildSlippageSummary(): Promise<SlippageSummary | null> {
    try {
      const [paperRows, scalpRows] = await Promise.all([
        // 체결분만(예약 PENDING 은 filledShares=0 → 제외). 매수·매도 양측 모두 슬리피지 기록.
        this.prisma.paperTrade.findMany({
          where: { filledShares: { gt: 0 } },
          select: {
            styleTag: true,
            direction: true,
            slippage: true,
            commission: true,
            tax: true,
            expectedPrice: true,
            entryPrice: true,
            filledPrice: true,
          },
        }),
        // 분봉 단타는 진입+청산 비용이 청산 시 합산 기록 → CLOSED 만 집계.
        this.prisma.intradayScalpTrade.findMany({
          where: { status: 'CLOSED' },
          select: { styleTag: true, slippage: true, commission: true, tax: true },
        }),
      ]);

      const buckets = new Map<string, SlippageAccumulator>();
      const bucketFor = (tag: string): SlippageAccumulator => {
        let acc = buckets.get(tag);
        if (!acc) {
          acc = { count: 0, slippageKrw: [], feesKrw: 0, bps: [] };
          buckets.set(tag, acc);
        }
        return acc;
      };

      for (const r of paperRows) {
        const acc = bucketFor(r.styleTag ?? UNTAGGED_TRACK);
        acc.count += 1;
        acc.slippageKrw.push(Number(r.slippage));
        acc.feesKrw += Number(r.commission) + Number(r.tax);
        // bps = 신호시점 기대가 대비 실현 이탈(부호=불리 방향 양수). expectedPrice 우선, 없으면
        //   entryPrice 폴백(placeOrder 트랙은 entryPrice가 곧 기준가 — 덮어쓰기 없음).
        const ref =
          r.expectedPrice != null ? Number(r.expectedPrice) : Number(r.entryPrice);
        const filled = r.filledPrice != null ? Number(r.filledPrice) : null;
        if (ref > 0 && filled != null) {
          const raw = (filled - ref) / ref;
          // 매수는 고가체결(+)이, 매도는 저가체결(−raw)이 불리 → 항상 불리=양수로 정규화.
          const signed = r.direction === 'SELL' ? -raw : raw;
          acc.bps.push(signed * BPS_SCALE);
        }
      }

      for (const r of scalpRows) {
        const acc = bucketFor(r.styleTag ?? UNTAGGED_TRACK);
        acc.count += 1;
        acc.slippageKrw.push(Number(r.slippage));
        acc.feesKrw += Number(r.commission) + Number(r.tax);
        // 단타는 expectedPrice 미보존 → bps 미산정(KRW 슬리피지·totalFees만 노출).
      }

      const overall: SlippageAccumulator = {
        count: 0,
        slippageKrw: [],
        feesKrw: 0,
        bps: [],
      };
      for (const acc of buckets.values()) {
        overall.count += acc.count;
        overall.slippageKrw.push(...acc.slippageKrw);
        overall.feesKrw += acc.feesKrw;
        overall.bps.push(...acc.bps);
      }

      const byTrack: SlippageTrackDistribution[] = [...buckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([styleTag, acc]) => ({ styleTag, ...this.toSlippageDistribution(acc) }));

      return { overall: this.toSlippageDistribution(overall), byTrack };
    } catch (err) {
      this.logger.warn(
        `슬리피지 집계 실패(graceful, null 노출): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** 슬리피지 누적기 → 분포(평균·p95·수수료·bps). 부동소수 잡음은 반올림 제거. */
  private toSlippageDistribution(acc: SlippageAccumulator): SlippageDistribution {
    return {
      tradeCount: acc.count,
      avgSlippageKrw: roundOrNull(meanOrNull(acc.slippageKrw), 2),
      p95SlippageKrw: roundOrNull(percentileOrNull(acc.slippageKrw, 0.95), 2),
      totalFeesKrw: roundOrNull(acc.feesKrw, 2) ?? 0,
      avgSlippageBps: roundOrNull(meanOrNull(acc.bps), 2),
      p95SlippageBps: roundOrNull(percentileOrNull(acc.bps, 0.95), 2),
      bpsSampleSize: acc.bps.length,
    };
  }

  /**
   * DAR-126 — 파이프라인 단계 카운트·지연·실패 행 요약.
   * PipelineModule 미배선(@Optional 미주입) 또는 집계 실패 시 null(graceful).
   */
  private async buildPipelineSummary(now: Date): Promise<PipelineHealth | null> {
    if (!this.pipeline) return null;
    try {
      return await this.pipeline.getHealth(now);
    } catch (err) {
      this.logger.warn(
        `pipeline 집계 실패(graceful, null 노출): ${(err as Error).message}`,
      );
      return null;
    }
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
