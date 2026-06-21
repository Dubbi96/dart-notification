import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { BacktestReplayService } from '../replay/backtest-replay.service';
import { EquityCurvePoint } from '../replay/backtest-equity-curve';
import { PerformanceMetrics, StrategyParams } from '../ports/backtest.types';
import {
  STRATEGY_PRESETS,
  StrategyPreset,
  findPreset,
  summarizeRules,
} from './strategy-presets';

/**
 * 표본이 이 거래 수 미만이면 승률·Sharpe 등 지표가 통계적으로 빈약하다고 보고 lowSample 플래그를 켠다.
 * 1년 트랙이면 정상 전략은 수십 건 이상 — 이 아래면 비교 신뢰도가 낮음을 화면에서 정직하게 표기한다.
 */
export const LOW_SAMPLE_TRADES = 20;

export interface StrategyComparisonEntry {
  strategyKey: string;
  label: string;
  description: string;
  rulesSummary: string;
  /** 트랙이 아직 산출되지 않았으면 false(게스트 데모 — 빈 곡선). */
  hasTrack: boolean;
  equityCurve: EquityCurvePoint[];
  cumulativeReturnPct: number;
  winRate: number;
  sampleCount: number;
  sharpe: number;
  mdd: number;
  lowSample: boolean;
  /** 누적수익 내림차순 순위(1=최고). 트랙 없으면 null. */
  rank: number | null;
  /** 최고 누적수익 전략 여부. */
  bestStrategy: boolean;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
}

export interface StrategyComparisonResult {
  /** 비교 기준 시점(가장 최근 완료 트랙 기준). */
  generatedAt: string | null;
  strategies: StrategyComparisonEntry[];
}

export interface StrategyTradeRow {
  entryDate: string;
  exitDate: string | null;
  corpName: string;
  corpCode: string;
  stockCode: string;
  eventType: string;
  persona: string;
  buyScoreSnapshot: number | null;
  entryPrice: number;
  exitPrice: number | null;
  returnPct: number | null;
  netPnl: number | null;
  exitReason: string | null;
  holdDays: number | null;
}

export interface StrategyTradeHistoryResult {
  strategyKey: string;
  label: string;
  description: string;
  rulesSummary: string;
  hasTrack: boolean;
  runId: string | null;
  startDate: string | null;
  endDate: string | null;
  totalTrades: number;
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
        const record = await this.replay.run({
          startDate,
          endDate,
          strategyKey: preset.key,
          name: `[${preset.label}] 전략 트랙 ${startDate}~${endDate}`,
          description: `DAR-404 전략 변형 트랙(${preset.key}) — point-in-time 리플레이(미래모름)`,
          strategy: preset.params,
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

  /** 전략 4종 비교 — 누적수익 내림차순 ranking + bestStrategy 플래그. 게스트 조회 가능. */
  async getComparison(): Promise<StrategyComparisonResult> {
    const latestByKey = await this.loadLatestRunsByKey();

    const raw: StrategyComparisonEntry[] = STRATEGY_PRESETS.map((preset) => {
      const run = latestByKey.get(preset.key);
      return this.toComparisonEntry(preset, run);
    });

    // 트랙이 있는 전략만 누적수익 내림차순으로 순위 부여.
    const ranked = raw
      .filter((e) => e.hasTrack)
      .sort((a, b) => b.cumulativeReturnPct - a.cumulativeReturnPct);
    ranked.forEach((entry, idx) => {
      entry.rank = idx + 1;
      entry.bestStrategy = idx === 0;
    });

    const generatedAt = raw
      .map((e) => e.completedAt)
      .filter((v): v is string => v != null)
      .sort()
      .pop() ?? null;

    return { generatedAt, strategies: raw };
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
      select: { id: true, startDate: true, endDate: true },
    });

    if (!run) {
      return {
        strategyKey: key,
        label: preset.label,
        description: preset.description,
        rulesSummary: summarizeRules(preset.params),
        hasTrack: false,
        runId: null,
        startDate: null,
        endDate: null,
        totalTrades: 0,
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
      entryDate: this.calendar.formatDate(t.entryDate),
      exitDate: t.exitDate ? this.calendar.formatDate(t.exitDate) : null,
      corpName: nameMap.get(t.corpCode) ?? t.corpCode,
      corpCode: t.corpCode,
      stockCode: t.stockCode,
      eventType: t.eventType,
      persona: t.persona,
      buyScoreSnapshot: t.buyScoreSnapshot ?? null,
      entryPrice: Number(t.entryPrice),
      exitPrice: t.exitPrice != null ? Number(t.exitPrice) : null,
      returnPct: t.returnPct != null ? Number(t.returnPct) : null,
      netPnl: t.netPnl != null ? Number(t.netPnl) : null,
      exitReason: t.exitReason ?? null,
      holdDays: t.holdDays ?? null,
    }));

    return {
      strategyKey: key,
      label: preset.label,
      description: preset.description,
      rulesSummary: summarizeRules(preset.params),
      hasTrack: true,
      runId: run.id,
      startDate: this.calendar.formatDate(run.startDate),
      endDate: this.calendar.formatDate(run.endDate),
      totalTrades: rows.length,
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
  ): StrategyComparisonEntry {
    const base = {
      strategyKey: preset.key,
      label: preset.label,
      description: preset.description,
      rulesSummary: summarizeRules(preset.params as StrategyParams),
    };

    if (!run) {
      return {
        ...base,
        hasTrack: false,
        equityCurve: [],
        cumulativeReturnPct: 0,
        winRate: 0,
        sampleCount: 0,
        sharpe: 0,
        mdd: 0,
        lowSample: true,
        rank: null,
        bestStrategy: false,
        startDate: null,
        endDate: null,
        completedAt: null,
      };
    }

    const summary = (run.summary ?? {}) as BacktestRunSummary;
    const metrics = summary.metrics;
    const sampleCount = metrics?.totalTrades ?? 0;

    return {
      ...base,
      hasTrack: true,
      equityCurve: summary.equityCurve ?? [],
      cumulativeReturnPct: metrics?.totalReturn ?? 0,
      winRate: metrics?.winRate ?? 0,
      sampleCount,
      sharpe: metrics?.sharpe ?? 0,
      mdd: metrics?.mdd ?? 0,
      lowSample: sampleCount < LOW_SAMPLE_TRADES,
      rank: null,
      bestStrategy: false,
      startDate: this.calendar.formatDate(run.startDate),
      endDate: this.calendar.formatDate(run.endDate),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
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
