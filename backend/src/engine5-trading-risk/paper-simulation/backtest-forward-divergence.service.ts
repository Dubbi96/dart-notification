/**
 * BacktestForwardDivergenceService — 백테스트 vs forward 성과 괴리 조인 리포트 + 일일 스냅샷 (견고화 W0·P04, DAR-479)
 *
 * ★배경(갭 E4 partial — 졸업 판정 핵심 지표 부재): 리플레이 트랙(BacktestRun.strategyKey, 과거 1년
 *   재생)과 forward 트랙(styleTag='strategy:<key>', 오늘 신호→오늘 진입 누적)은 그간 "별개 표면"으로
 *   조인이 없었다. 이 서비스가 strategyKey 로 두 축을 조인해 수익률·승률·거래빈도·보유기간의 괴리를
 *   read-only 로 산출하고, 추세 추적용 일일 스냅샷을 적재한다.
 *
 * - 백테스트 축: 전략별 최신 COMPLETED BacktestRun.summary.metrics(리플레이 지표) + 창(startDate~endDate).
 *   StrategyTrackService.loadLatestRunsByKey 조회 패턴 계승(read-only, engine3 계약 무변경).
 * - forward 축: StrategyForwardSimulationService.getStrategyForwardComparison()(기존 read-only 집계) 재사용.
 * - 괴리 산출: 순수 함수 backtest-forward-divergence.ts 위임(승률=통일 정의, gap=calibration 의미론 계승).
 *
 * ★ 조회·적재 전용 — 트레이딩 행동(매수·체결·손절·청산) 무접촉. 실주문 0, AI 미개입(순수 산술/집계).
 *   신규 수집·외부호출 없음(이미 저장된 BacktestRun·forward 성과만 조합). 표본 부족은 LOW_SAMPLE 정직 표기.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  STRATEGY_PRESETS,
  STRATEGY_INITIAL_CAPITAL,
} from '../../engine3-quant-market/backtest/strategies/strategy-presets';
import { LOW_SAMPLE_TRADES } from '../../engine3-quant-market/backtest/strategies/strategy-track.service';
import { PerformanceMetrics } from '../../engine3-quant-market/backtest/ports/backtest.types';
import {
  StrategyForwardSimulationService,
  StrategyForwardPerformance,
  STRATEGY_FORWARD_LOW_SAMPLE_THRESHOLD,
} from './strategy-forward-simulation.service';
import {
  buildStrategyDivergence,
  computeTradesPerMonth,
  spanDaysBetween,
  findMetric,
  DivergenceTrackMetrics,
  StrategyDivergence,
  DIVERGENCE_EPSILON,
  DIVERGENCE_DISCLAIMER,
} from './backtest-forward-divergence';

/** 백테스트 축 한 전략의 최신 리플레이 지표 + 창 일자. */
interface BacktestRunMetricsRow {
  metrics: PerformanceMetrics | null;
  /** 리플레이 창 시작(YYYYMMDD). */
  startYmd: string;
  /** 리플레이 창 종료(YYYYMMDD). */
  endYmd: string;
}

/** 전략 괴리 조인 리포트(read-only). */
export interface BacktestForwardDivergenceReport {
  initialCapital: number;
  /** 표본 부족 임계(과신 방지) — backtest 20건 / forward 5건(기존 임계 준수). */
  lowSampleThresholds: { backtest: number; forward: number };
  /** 지표별 괴리 판정 임계(투명성). */
  epsilon: typeof DIVERGENCE_EPSILON;
  strategies: StrategyDivergence[];
  disclaimer: string;
}

/** 괴리 추세 1점(스냅샷 1행 → 화면 계약). */
export interface DivergenceTrendPoint {
  snapshotDate: string;
  returnGapPct: number | null;
  winRateGap: number | null;
  tradeFreqGap: number | null;
  holdDaysGap: number | null;
  lowSample: boolean;
}

/** 괴리 추세 응답. */
export interface DivergenceTrendResult {
  strategyKey: string;
  points: DivergenceTrendPoint[];
}

@Injectable()
export class BacktestForwardDivergenceService {
  private readonly logger = new Logger(BacktestForwardDivergenceService.name);

  /** 추세 조회 기본 최대 반환 점수(최근 N일). */
  private static readonly TREND_DEFAULT_LIMIT = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyForward: StrategyForwardSimulationService,
  ) {}

  // ─── 1) 조인 리포트(read-only) ─────────────────────────────────────────────
  /**
   * 전략 4종의 백테스트 대비 forward 괴리 리포트. 백테스트 최신 리플레이 지표와 forward 실운용
   * 누적 성적표를 strategyKey 로 조인한다. ★ 신규 수집·체결·AI 0 — 이미 저장된 값만 조합.
   */
  async getDivergenceReport(): Promise<BacktestForwardDivergenceReport> {
    const [backtestByKey, forwardComparison] = await Promise.all([
      this.loadBacktestMetricsByKey(),
      this.strategyForward.getStrategyForwardComparison(),
    ]);
    const forwardByKey = new Map<string, StrategyForwardPerformance>(
      forwardComparison.strategies.map((s) => [s.key, s]),
    );

    const strategies: StrategyDivergence[] = STRATEGY_PRESETS.map((preset) =>
      buildStrategyDivergence({
        key: preset.key,
        label: preset.label,
        tagline: preset.description,
        backtest: this.toBacktestTrack(backtestByKey.get(preset.key) ?? null),
        forward: this.toForwardTrack(forwardByKey.get(preset.key) ?? null),
        backtestLowSampleThreshold: LOW_SAMPLE_TRADES,
        forwardLowSampleThreshold: STRATEGY_FORWARD_LOW_SAMPLE_THRESHOLD,
      }),
    );

    return {
      initialCapital: STRATEGY_INITIAL_CAPITAL,
      lowSampleThresholds: {
        backtest: LOW_SAMPLE_TRADES,
        forward: STRATEGY_FORWARD_LOW_SAMPLE_THRESHOLD,
      },
      epsilon: DIVERGENCE_EPSILON,
      strategies,
      disclaimer: DIVERGENCE_DISCLAIMER,
    };
  }

  // ─── 2) 일일 스냅샷 적재(추세 추적용) ──────────────────────────────────────
  /**
   * 전략별 괴리를 하루치(멱등키 strategyKey+snapshotDate) 적재한다. 재실행 시 upsert 로 갱신.
   * ★ 적재 전용 — 트레이딩 행동 무접촉. forward 사이클(스냅샷 확정) 직후 스케줄러가 호출한다.
   */
  async snapshotDailyDivergence(
    tradeDate: string,
  ): Promise<{ snapshotDate: string; snapshotted: number }> {
    const report = await this.getDivergenceReport();
    let snapshotted = 0;

    for (const s of report.strategies) {
      const returnGapPct = findMetric(s, 'return')?.gap ?? null;
      const winRateGap = findMetric(s, 'winRate')?.gap ?? null;
      const tradeFreqGap = findMetric(s, 'tradeFrequency')?.gap ?? null;
      const holdDaysGap = findMetric(s, 'holdDays')?.gap ?? null;

      const persist = {
        backtestReturnPct: s.backtest.returnPct,
        backtestWinRate: s.backtest.winRate,
        backtestTradeCount: s.backtestSampleSize,
        backtestAvgHoldDays: s.backtest.avgHoldDays,
        backtestTradesPerMonth: s.backtest.tradesPerMonth,
        forwardReturnPct: s.forward.returnPct,
        forwardWinRate: s.forward.winRate,
        forwardTradeCount: s.forwardSampleSize,
        forwardAvgHoldDays: s.forward.avgHoldDays,
        forwardTradesPerMonth: s.forward.tradesPerMonth,
        returnGapPct,
        winRateGap,
        tradeFreqGap,
        holdDaysGap,
        lowSample: s.lowSample,
      };

      await this.prisma.backtestForwardDivergenceSnapshot.upsert({
        where: {
          strategyKey_snapshotDate: { strategyKey: s.key, snapshotDate: tradeDate },
        },
        create: { strategyKey: s.key, snapshotDate: tradeDate, ...persist },
        update: persist,
      });
      snapshotted++;
    }

    this.logger.log(`[Divergence] 괴리 스냅샷 적재 tradeDate=${tradeDate} 전략=${snapshotted}건`);
    return { snapshotDate: tradeDate, snapshotted };
  }

  // ─── 3) 괴리 추세 조회(read-only) ──────────────────────────────────────────
  /** 한 전략의 일별 괴리 추세(최근 limit일, 오름차순). 스냅샷 미적재면 빈 배열(정직). */
  async getDivergenceTrend(
    strategyKey: string,
    limit = BacktestForwardDivergenceService.TREND_DEFAULT_LIMIT,
  ): Promise<DivergenceTrendResult> {
    const rows = await this.prisma.backtestForwardDivergenceSnapshot.findMany({
      where: { strategyKey },
      orderBy: { snapshotDate: 'desc' },
      take: Math.max(1, Math.min(limit, 365)),
    });
    const points: DivergenceTrendPoint[] = rows
      .reverse()
      .map((r) => ({
        snapshotDate: r.snapshotDate,
        returnGapPct: r.returnGapPct,
        winRateGap: r.winRateGap,
        tradeFreqGap: r.tradeFreqGap,
        holdDaysGap: r.holdDaysGap,
        lowSample: r.lowSample,
      }));
    return { strategyKey, points };
  }

  // ─── 축 매핑(순수 변환) ─────────────────────────────────────────────────────
  /**
   * 백테스트 리플레이 지표 → 괴리 입력. 승률은 % → 0~1 비율(통일 정의). 표본 0이면 지표 null.
   * 거래빈도는 리플레이 창(startDate~endDate) 일수로 월 환산.
   */
  private toBacktestTrack(row: BacktestRunMetricsRow | null): DivergenceTrackMetrics {
    if (!row || !row.metrics) {
      return { returnPct: null, winRate: null, avgHoldDays: null, tradesPerMonth: null, sampleSize: 0 };
    }
    const m = row.metrics;
    const sampleSize = m.totalTrades ?? 0;
    const windowDays = spanDaysBetween(row.startYmd, row.endYmd);
    return {
      // 표본 0이면 지표 null(과신 방지) — DTO 계약(strategy-track)과 동일한 정직 표기.
      returnPct: sampleSize > 0 ? (m.totalReturn ?? null) : null,
      winRate: sampleSize > 0 && m.winRate != null ? m.winRate / 100 : null,
      avgHoldDays: sampleSize > 0 ? (m.avgHoldDays ?? null) : null,
      tradesPerMonth: windowDays !== null ? computeTradesPerMonth(sampleSize, windowDays) : null,
      sampleSize,
    };
  }

  /**
   * forward 성적표 → 괴리 입력. winRate/avgHoldDays 는 이미 표본 0일 때 null(scorecard 계약).
   * 거래빈도는 forward 운용기간(첫~마지막 스냅샷) 일수로 월 환산.
   * ★ returnPct 는 realized(청산) 기준 누적수익률 — 백테스트(창 종료 전량청산=realized)와 apples-to-apples.
   */
  private toForwardTrack(fw: StrategyForwardPerformance | null): DivergenceTrackMetrics {
    if (!fw) {
      return { returnPct: null, winRate: null, avgHoldDays: null, tradesPerMonth: null, sampleSize: 0 };
    }
    const sc = fw.scorecard;
    const sampleSize = sc.sampleSize;
    const first = fw.equityCurve.length > 0 ? fw.equityCurve[0].snapshotDate : null;
    const last =
      fw.equityCurve.length > 0 ? fw.equityCurve[fw.equityCurve.length - 1].snapshotDate : null;
    const spanDays = spanDaysBetween(first, last);
    return {
      returnPct: sampleSize > 0 ? sc.cumulativeReturnPct : null,
      winRate: sc.winRate,
      avgHoldDays: sc.avgHoldDays,
      tradesPerMonth: spanDays !== null ? computeTradesPerMonth(sampleSize, spanDays) : null,
      sampleSize,
    };
  }

  // ─── 백테스트 최신 리플레이 지표 적재(StrategyTrackService 조회 패턴 계승) ───
  private async loadBacktestMetricsByKey(): Promise<Map<string, BacktestRunMetricsRow>> {
    const runs = await this.prisma.backtestRun.findMany({
      where: {
        strategyKey: { in: STRATEGY_PRESETS.map((p) => p.key) },
        status: 'COMPLETED',
      },
      orderBy: { completedAt: 'desc' },
      select: { strategyKey: true, summary: true, startDate: true, endDate: true },
    });

    const byKey = new Map<string, BacktestRunMetricsRow>();
    for (const run of runs) {
      if (!run.strategyKey || byKey.has(run.strategyKey)) continue;
      const summary = (run.summary ?? {}) as { metrics?: PerformanceMetrics };
      byKey.set(run.strategyKey, {
        metrics: summary.metrics ?? null,
        startYmd: toUtcYmd(run.startDate),
        endYmd: toUtcYmd(run.endDate),
      });
    }
    return byKey;
  }
}

/**
 * Date → YYYYMMDD(UTC 파트). ★ 창 span(종료−시작) 산출 전용 — start/end 를 동일 규칙으로 변환하므로
 * 절대 TZ 오프셋은 차분에서 상쇄된다(거래빈도 정규화에 절대일자 무관).
 */
function toUtcYmd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}
