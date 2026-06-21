import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { BacktestReplayService } from '../replay/backtest-replay.service';
import { EquityCurvePoint } from '../replay/backtest-equity-curve';
import { PerformanceMetrics, StrategyParams } from '../ports/backtest.types';
import {
  STRATEGY_PRESETS,
  STRATEGY_INITIAL_CAPITAL,
  StrategyPreset,
  findPreset,
  summarizeEntryRule,
  summarizeExitRule,
} from './strategy-presets';
import { EventEdgeSelectorService } from './event-edge-selector.service';

/**
 * 표본이 이 거래 수 미만이면 승률·Sharpe 등 지표가 통계적으로 빈약하다고 보고 lowSample 플래그를 켠다.
 * 1년 트랙이면 정상 전략은 수십 건 이상 — 이 아래면 비교 신뢰도가 낮음을 화면에서 정직하게 표기한다.
 */
export const LOW_SAMPLE_TRADES = 20;

/**
 * ★ 응답 계약 SSOT = 모바일 `mobile/types/strategy-comparison.types.ts`(DAR-405).
 *   아래 인터페이스들은 그 타입과 1:1 로 정렬한다(DAR-407 계약 정합). 필드명·구조를 바꿀 때는
 *   반드시 양쪽을 함께 갱신할 것 — 한쪽만 바뀌면 전략탭이 Render Error 로 크래시한다.
 */

/** 전략별 자산곡선 1점 — 모바일 EquityCurvePoint(snapshotDate·totalValue·returnPct) 와 1:1. */
export interface StrategyEquityPoint {
  /** 청산일(YYYY-MM-DD). */
  snapshotDate: string;
  /** 해당 시점 누적 평가액(초기자본 + 누적 netPnl). */
  totalValue: number;
  /** 초기자본 대비 누적 수익률(%). */
  returnPct: number;
}

/** 전략 1종 성과 — 모바일 StrategyPerformance 와 1:1. */
export interface StrategyPerformanceDto {
  key: string;
  label: string;
  /** 한 줄 컨셉(모바일 tagline = preset.description). */
  tagline: string;
  initialCapital: number;
  equityCurve: StrategyEquityPoint[];
  cumulativeReturnPct: number;
  /** 승률(0~1 비율) — 청산 표본 0이면 null. */
  winRate: number | null;
  /** 총 트레이드 수(진입 기준). */
  tradeCount: number;
  /** 청산 완료 표본 수. */
  sampleSize: number;
  /** Sharpe — 표본 0이면 null. */
  sharpe: number | null;
  /** 최대낙폭 MDD(%, 0 이하) — 표본 0이면 null. */
  maxDrawdownPct: number | null;
  /** 벤치마크(KOSPI) 대비 초과수익(%p) — 미산출이면 null(정직). */
  benchmarkAlphaPct: number | null;
  /** 진입/청산 룰 평문(모바일 StrategyRules). */
  rules: { entry: string; exit: string };
  /** 청산 표본 < 임계 — 과신 방지. */
  lowSample: boolean;
}

/** 전략 비교 랭킹 — 모바일 StrategyRanking 와 1:1. */
export interface StrategyRankingDto {
  /** 표시 순서(표본 있는 전략 누적수익 내림차순 → 미산출 후순위) 전략 key 목록(전체). */
  ranking: string[];
  /** 표본 있는 전략 중 최고 누적수익 key(없으면 null). */
  bestKey: string | null;
  /** 표본 있는 전략이 모두 LOW_SAMPLE 이면 true(과신 금지). */
  allLowSample: boolean;
}

/** 전략 비교 응답 — 모바일 StrategyComparison 와 1:1(GET /strategies/comparison). */
export interface StrategyComparisonResult {
  initialCapital: number;
  strategies: StrategyPerformanceDto[];
  ranking: StrategyRankingDto;
  /** 표본 부족 임계(LOW_SAMPLE_TRADES). */
  lowSampleThreshold: number;
}

/** 드릴다운 매수/매도 1행 — 모바일 StrategyTrade 와 1:1. */
export interface StrategyTradeRow {
  /** 행 식별자(BacktestTrade id). */
  id: string;
  stockCode: string;
  /** 종목명(없으면 stockCode 폴백). */
  stockName: string;
  eventType: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  returnPct: number | null;
  exitReason: string | null;
  holdDays: number | null;
  /** 포지션 상태. */
  status: 'OPEN' | 'CLOSED';
}

/** 전략 매수/매도 타임라인 응답 — 모바일 StrategyTradeHistory 와 1:1(GET /strategies/:key/trade-history). */
export interface StrategyTradeHistoryResult {
  key: string;
  label: string;
  tagline: string;
  rules: { entry: string; exit: string };
  trades: StrategyTradeRow[];
}

export interface StrategyTrackRefreshSummary {
  startDate: string;
  endDate: string;
  results: Array<{
    strategyKey: string;
    status: 'COMPLETED' | 'FAILED';
    runId?: string;
    totalTrades?: number;
    cumulativeReturnPct?: number;
    error?: string;
  }>;
}

interface BacktestRunSummary {
  metrics?: PerformanceMetrics;
  equityCurve?: EquityCurvePoint[];
  totalSignals?: number;
}

/**
 * StrategyTrackService — DAR-404 전략 변형 4종 다중 트랙 오케스트레이터 + 비교/거래내역 조회.
 *
 * - refreshAll(): 4 프리셋을 각각 point-in-time 리플레이(미래모름)로 실행해 BacktestRun 4개를
 *   strategyKey 와 함께 저장한다. 멱등 — 전략별 직전 run 은 새 run 성공 후 삭제(최신 1개 유지).
 * - getComparison(): 전략별 최신 완료 트랙을 모아 누적수익 내림차순 ranking + bestStrategy 부여.
 * - getTradeHistory(key): 해당 전략 최신 트랙의 BacktestTrade(과거 매수/매도) 최신순 반환.
 *
 * ★ point-in-time 불가침 — 실행은 BacktestReplayService(다음 거래일 시가 진입·asOf 절단)에 위임한다.
 *   AI 금지영역: 신호·체결·손절·청산 전부 순수 Rule. AI 개입 0.
 */
@Injectable()
export class StrategyTrackService {
  private readonly logger = new Logger(StrategyTrackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly replay: BacktestReplayService,
    private readonly calendar: MarketCalendarService,
    private readonly eventEdgeSelector: EventEdgeSelectorService,
  ) {}

  /**
   * 4 프리셋 다중 트랙 갱신. 기본 윈도 = endDate(오늘) 기준 직전 1년.
   * 한 전략이 실패해도 나머지는 계속 진행한다(부분 성공 허용).
   */
  async refreshAll(window?: { startDate: string; endDate: string }): Promise<StrategyTrackRefreshSummary> {
    const { startDate, endDate } = window ?? this.defaultWindow();
    const results: StrategyTrackRefreshSummary['results'] = [];

    for (const preset of STRATEGY_PRESETS) {
      try {
        // DAR-408: robustEventGate 전략(event-edge)은 매수 eventTypes 를 robust 통계로 동적 주입.
        //   다른 3전략은 무변경(preset.params 그대로). 양-edge 없으면 빈 allowlist → 진입 0.
        const params = await this.resolveParams(preset);

        const record = await this.replay.run({
          startDate,
          endDate,
          strategyKey: preset.key,
          name: `[${preset.label}] 전략 트랙 ${startDate}~${endDate}`,
          description: `DAR-404 전략 변형 트랙(${preset.key}) — point-in-time 리플레이(미래모름)`,
          strategy: params,
        });

        // 멱등: 직전 동일 전략 run 정리(최신 1개만 유지). 트레이드는 cascade 삭제.
        const deleted = await this.prisma.backtestRun.deleteMany({
          where: { strategyKey: preset.key, id: { not: record.runId } },
        });
        if (deleted.count > 0) {
          this.logger.log(`[${preset.key}] 직전 트랙 ${deleted.count}건 정리(최신 유지)`);
        }

        results.push({
          strategyKey: preset.key,
          status: 'COMPLETED',
          runId: record.runId,
          totalTrades: record.metrics.totalTrades,
          cumulativeReturnPct: record.metrics.totalReturn,
        });
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`[${preset.key}] 트랙 갱신 실패: ${message}`);
        results.push({ strategyKey: preset.key, status: 'FAILED', error: message });
      }
    }

    return { startDate, endDate, results };
  }

  /**
   * DAR-408: robustEventGate 전략은 EventStudy robust 통계로 매수 eventTypes 를 동적 선별해 주입한다.
   * 양-edge 가 없으면 eventTypes=[] (빈 allowlist) → 러너가 진입 0(do-no-harm). 게이트 없는 전략은
   * preset.params 를 그대로 반환(다른 3전략 무변경).
   */
  private async resolveParams(preset: StrategyPreset): Promise<StrategyParams> {
    if (!preset.robustEventGate) return preset.params;

    const selection = await this.eventEdgeSelector.selectPositiveEdgeEventTypes();
    return { ...preset.params, eventTypes: selection.eventTypes };
  }

  /**
   * 전략 4종 비교 — 모바일 StrategyComparison 계약과 1:1. 게스트 조회 가능.
   * ranking.ranking = 표본 있는 전략(누적수익 내림차순) → 미산출 전략 후순위. bestKey/allLowSample 은
   * '표본 있는(청산 표본>0)' 전략만으로 판정해 과신을 막는다.
   */
  async getComparison(): Promise<StrategyComparisonResult> {
    const latestByKey = await this.loadLatestRunsByKey();

    const strategies: StrategyPerformanceDto[] = STRATEGY_PRESETS.map((preset) =>
      this.toComparisonEntry(preset, latestByKey.get(preset.key)),
    );

    // 표본 있는(청산 표본>0) 전략만으로 best / allLowSample 판정.
    const sampled = strategies.filter((s) => s.sampleSize > 0);
    const best = sampled.reduce<StrategyPerformanceDto | null>(
      (top, s) => (top === null || s.cumulativeReturnPct > top.cumulativeReturnPct ? s : top),
      null,
    );
    const bestKey = best ? best.key : null;
    const allLowSample = sampled.length === 0 ? true : sampled.every((s) => s.lowSample);

    // 카드 표시 순서: 표본 있는 전략 먼저(누적수익 내림차순) → 미산출 전략 후순위.
    const ranking = [...strategies]
      .sort(
        (a, b) =>
          Number(b.sampleSize > 0) - Number(a.sampleSize > 0) ||
          b.cumulativeReturnPct - a.cumulativeReturnPct,
      )
      .map((s) => s.key);

    return {
      initialCapital: STRATEGY_INITIAL_CAPITAL,
      strategies,
      ranking: { ranking, bestKey, allLowSample },
      lowSampleThreshold: LOW_SAMPLE_TRADES,
    };
  }

  /** 전략별 과거 매수/매도 트랙(BacktestTrade) 최신순. 게스트 조회 가능. */
  async getTradeHistory(key: string): Promise<StrategyTradeHistoryResult> {
    const preset = findPreset(key);
    if (!preset) {
      throw new NotFoundException(`알 수 없는 전략 키: ${key}`);
    }

    const run = await this.prisma.backtestRun.findFirst({
      where: { strategyKey: key, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    });

    const rulesOf = (p: StrategyPreset) => ({
      entry: summarizeEntryRule(p.params),
      exit: summarizeExitRule(p.params),
    });

    if (!run) {
      // 트랙 미산출 — graceful 빈 타임라인(게스트 데모).
      return {
        key,
        label: preset.label,
        tagline: preset.description,
        rules: rulesOf(preset),
        trades: [],
      };
    }

    const trades = await this.prisma.backtestTrade.findMany({
      where: { backtestRunId: run.id },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    });

    const corpCodes = Array.from(new Set(trades.map((t) => t.corpCode)));
    const companies = corpCodes.length
      ? await this.prisma.company.findMany({
          where: { corpCode: { in: corpCodes } },
          select: { corpCode: true, corpName: true },
        })
      : [];
    const nameMap = new Map(companies.map((c) => [c.corpCode, c.corpName]));

    const rows: StrategyTradeRow[] = trades.map((t) => ({
      id: t.id,
      stockCode: t.stockCode,
      stockName: nameMap.get(t.corpCode) ?? t.stockCode,
      eventType: t.eventType,
      entryDate: this.calendar.formatDate(t.entryDate),
      exitDate: t.exitDate ? this.calendar.formatDate(t.exitDate) : null,
      entryPrice: Number(t.entryPrice),
      exitPrice: t.exitPrice != null ? Number(t.exitPrice) : null,
      returnPct: t.returnPct != null ? Number(t.returnPct) : null,
      exitReason: t.exitReason ?? null,
      holdDays: t.holdDays ?? null,
      status: t.exitDate ? 'CLOSED' : 'OPEN',
    }));

    return {
      key,
      label: preset.label,
      tagline: preset.description,
      rules: rulesOf(preset),
      trades: rows,
    };
  }

  /** 전략별 최신 완료 run 1개씩 적재(완료시각 내림차순 — 첫 값이 최신). */
  private async loadLatestRunsByKey(): Promise<
    Map<
      string,
      {
        id: string;
        startDate: Date;
        endDate: Date;
        summary: unknown;
        completedAt: Date | null;
      }
    >
  > {
    const runs = await this.prisma.backtestRun.findMany({
      where: { strategyKey: { in: STRATEGY_PRESETS.map((p) => p.key) }, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        strategyKey: true,
        startDate: true,
        endDate: true,
        summary: true,
        completedAt: true,
      },
    });

    const byKey = new Map<
      string,
      { id: string; startDate: Date; endDate: Date; summary: unknown; completedAt: Date | null }
    >();
    for (const run of runs) {
      if (!run.strategyKey) continue;
      if (!byKey.has(run.strategyKey)) {
        byKey.set(run.strategyKey, {
          id: run.id,
          startDate: run.startDate,
          endDate: run.endDate,
          summary: run.summary,
          completedAt: run.completedAt,
        });
      }
    }
    return byKey;
  }

  private toComparisonEntry(
    preset: StrategyPreset,
    run?: { id: string; startDate: Date; endDate: Date; summary: unknown; completedAt: Date | null },
  ): StrategyPerformanceDto {
    const base = {
      key: preset.key,
      label: preset.label,
      tagline: preset.description,
      initialCapital: preset.params.initialCapital,
      rules: { entry: summarizeEntryRule(preset.params), exit: summarizeExitRule(preset.params) },
    };

    if (!run) {
      // 트랙 미산출 — 빈 곡선·표본 0·지표 null(과신 방지). lowSample true.
      return {
        ...base,
        equityCurve: [],
        cumulativeReturnPct: 0,
        winRate: null,
        tradeCount: 0,
        sampleSize: 0,
        sharpe: null,
        maxDrawdownPct: null,
        benchmarkAlphaPct: null,
        lowSample: true,
      };
    }

    const summary = (run.summary ?? {}) as BacktestRunSummary;
    const metrics = summary.metrics;
    // 이 엔진의 metrics.totalTrades 는 청산 완료 트레이드 수(자산곡선·승률의 표본). 진입 수와 동일
    // (윈도 종료 시 전 포지션 청산) — tradeCount/sampleSize 둘 다 여기서 끌어온다.
    const sampleSize = metrics?.totalTrades ?? 0;
    const winRatePct = metrics?.winRate; // % 단위
    return {
      ...base,
      // BE 자산곡선(date·equity) → 모바일 계약(snapshotDate·totalValue) 으로 정렬.
      equityCurve: (summary.equityCurve ?? []).map((p) => ({
        snapshotDate: p.date,
        totalValue: p.equity,
        returnPct: p.returnPct,
      })),
      cumulativeReturnPct: metrics?.totalReturn ?? 0,
      // 모바일은 승률을 0~1 비율로 소비 — % → 비율 변환. 표본 0이면 null.
      winRate: sampleSize > 0 && winRatePct != null ? winRatePct / 100 : null,
      tradeCount: sampleSize,
      sampleSize,
      sharpe: sampleSize > 0 ? (metrics?.sharpe ?? null) : null,
      maxDrawdownPct: sampleSize > 0 ? (metrics?.mdd ?? null) : null,
      // KOSPI 대비 초과수익은 현재 트랙 메트릭에 미산출 — 정직하게 측정 불가(null).
      benchmarkAlphaPct: null,
      lowSample: sampleSize < LOW_SAMPLE_TRADES,
    };
  }

  /** 기본 윈도 = 오늘(KST) 기준 직전 1년. */
  private defaultWindow(): { startDate: string; endDate: string } {
    const now = new Date();
    const endDate = this.calendar.formatDate(now);
    const startMs = now.getTime() - 365 * 24 * 60 * 60 * 1000;
    const startDate = this.calendar.formatDate(new Date(startMs));
    return { startDate, endDate };
  }
}
