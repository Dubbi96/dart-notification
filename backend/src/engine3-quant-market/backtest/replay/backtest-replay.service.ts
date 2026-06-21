import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketCalendarService } from '../constraint/market-calendar.service';
import { PriceConstraintService } from '../constraint/price-constraint.service';
import { PerformanceCalculatorService } from '../metrics/performance-calculator.service';
import { BacktestRunnerService } from '../backtest-runner.service';
import { PriceDataPort } from '../ports/price-data.port';
import { PrismaBacktestPriceAdapter } from '../ports/prisma-price-data.adapter';
import { BacktestSignalAssemblyService } from './backtest-signal-assembly.service';
import { buildEquityCurve, EquityCurvePoint } from './backtest-equity-curve';
import {
  DisclosureSignal,
  StrategyParams,
  BacktestCostParams,
  SimulatedTrade,
  PerformanceMetrics,
} from '../ports/backtest.types';

/**
 * 라이브 자동매매 모의투자와 일관된 기본 전략(시스템 하드룰).
 * - 손절 -8% / 익절 +20% / 최대보유 20거래일 (PaperSimulationService 상수와 정렬)
 * - 최소 매수점수 50 (ENTRY_FALLBACK_MIN_BUY_SCORE)
 * - 초기자본 1천만원 / 최대 동시보유 50 (균등배분)
 */
export const DEFAULT_REPLAY_STRATEGY: StrategyParams = {
  minBuyScore: 50,
  entryRule: 'NEXT_OPEN',
  exitRules: {
    takeProfitPct: 20,
    stopLossPct: -8,
    maxHoldDays: 20,
  },
  sizeRule: 'EQUAL_WEIGHT',
  maxPositions: 50,
  initialCapital: 10_000_000,
};

/** 한국 주식 현실 비용(매수·매도 수수료 0.015%, 거래세 0.18%, 슬리피지 0.3%) */
export const DEFAULT_REPLAY_COSTS: BacktestCostParams = {
  commissionRate: 0.00015,
  taxRate: 0.0018,
  slippagePct: 0.003,
};

export interface ReplayInput {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  name?: string;
  strategy?: Partial<StrategyParams>;
  costs?: Partial<BacktestCostParams>;
  /** DAR-404: 트레이딩 로직(전략 변형) 식별 키. 단일 트랙 리플레이는 미지정(NULL). */
  strategyKey?: string;
  /** 영속 description override(전략 변형 트랙 식별용). */
  description?: string;
}

export interface BacktestTrackRecord {
  runId: string;
  name: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  status: string;
  totalSignals: number;
  metrics: PerformanceMetrics;
  equityCurve: EquityCurvePoint[];
  strategy: StrategyParams;
  costs: BacktestCostParams;
  completedAt: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REPLAY_UNIVERSE = 'ALL_LISTED';

/** returnPct 컬럼 정밀도 Decimal(8,4) 표현 한계(±9999.9999) — 초과 시 클램프(DAR-390) */
export const RETURN_PCT_LIMIT = 9999.9999;

/** 유한·양수 여부(진입 필수 수치 검증용) */
export function isFinitePositive(v: number | undefined | null): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** 유한값이면 그대로, 아니면 null(선택 수치 필드 정규화) */
export function finiteOrNull(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 유한값이면 그대로, 아니면 fallback(비용 등 기본 0 필드) */
export function finiteOr(v: number | undefined | null, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** returnPct 정규화 — 비유한은 null, 범위 초과는 표현 가능 한계로 클램프 */
export function clampReturnPct(v: number | undefined | null): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v > RETURN_PCT_LIMIT) return RETURN_PCT_LIMIT;
  if (v < -RETURN_PCT_LIMIT) return -RETURN_PCT_LIMIT;
  return v;
}

/**
 * BacktestReplayService — 1년 자동매매 모의투자 point-in-time 리플레이 오케스트레이터.
 *
 * point-in-time 보장(3중):
 *  1) 신호: BacktestSignalAssemblyService 가 rcpDt 구간 내 신호만 조립(미래 공시 미참조).
 *  2) 가격: PrismaBacktestPriceAdapter(asOf=endDate) 가 상한 초과 일봉 절단 +
 *           러너가 일자별 [day,day] 만 조회(다음 거래일 시가 진입·당일 종가 진입 금지).
 *  3) 결과: 확정 청산만 사후 집계 → 트랙레코드(수익률·승률·MDD·자산곡선)로 영속.
 *
 * AI 금지영역: 신호·체결·손절·청산 전부 순수 Rule. AI 개입 0(라이브와 동일).
 */
@Injectable()
export class BacktestReplayService {
  private readonly logger = new Logger(BacktestReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assembly: BacktestSignalAssemblyService,
    private readonly calendar: MarketCalendarService,
    private readonly constraint: PriceConstraintService,
    private readonly performance: PerformanceCalculatorService,
  ) {}

  /** 1년 리플레이 실행 — 신호 조립 → 러너 실행 → 트랙레코드 산출·저장 */
  async run(input: ReplayInput): Promise<BacktestTrackRecord> {
    this.assertDate(input.startDate, 'startDate');
    this.assertDate(input.endDate, 'endDate');
    if (input.endDate < input.startDate) {
      throw new BadRequestException('endDate 는 startDate 이후여야 합니다.');
    }

    const strategy: StrategyParams = { ...DEFAULT_REPLAY_STRATEGY, ...input.strategy };
    const costs: BacktestCostParams = { ...DEFAULT_REPLAY_COSTS, ...input.costs };
    const name = input.name ?? `1년 자동매매 트랙레코드 ${input.startDate}~${input.endDate}`;

    const run = await this.prisma.backtestRun.create({
      data: {
        name,
        description:
          input.description ?? 'DAR-385 point-in-time 1년 리플레이(미래모름 백테스트)',
        strategyKey: input.strategyKey ?? null,
        strategyParams: strategy as unknown as object,
        startDate: this.calendar.parseDate(input.startDate),
        endDate: this.calendar.parseDate(input.endDate),
        universe: REPLAY_UNIVERSE,
        commissionRate: costs.commissionRate,
        taxRate: costs.taxRate,
        slippagePct: costs.slippagePct,
        status: 'RUNNING',
        startedAt: new Date(),
      },
      select: { id: true },
    });

    try {
      const signals = await this.assembly.assemble(input.startDate, input.endDate, {
        minBuyScore: strategy.minBuyScore,
        personas: strategy.personas,
      });

      const adapter = new PrismaBacktestPriceAdapter(this.prisma, input.endDate);
      const { trades, metrics, equityCurve } = await this.executeReplay(
        signals,
        adapter,
        strategy,
        costs,
        input.startDate,
        input.endDate,
      );

      await this.persistTrades(run.id, trades);
      const completedAt = new Date();
      await this.prisma.backtestRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt,
          summary: {
            metrics,
            equityCurve,
            totalSignals: signals.length,
          } as unknown as object,
        },
      });

      this.logger.log(
        `리플레이 완료 [${run.id}] 신호 ${signals.length}건 → 거래 ${metrics.totalTrades}건 · 수익률 ${metrics.totalReturn.toFixed(2)}% · 승률 ${metrics.winRate.toFixed(1)}%`,
      );

      return {
        runId: run.id,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        initialCapital: strategy.initialCapital,
        status: 'COMPLETED',
        totalSignals: signals.length,
        metrics,
        equityCurve,
        strategy,
        costs,
        completedAt: completedAt.toISOString(),
      };
    } catch (err) {
      await this.prisma.backtestRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage: (err as Error).message },
      });
      throw err;
    }
  }

  /**
   * 순수 실행부(DB 영속 분리) — 러너 실행 + 성과/자산곡선 산출.
   * 테스트는 InMemoryPriceDataAdapter 로 이 메서드를 결정론적으로 검증한다.
   */
  async executeReplay(
    signals: DisclosureSignal[],
    priceAdapter: PriceDataPort,
    strategy: StrategyParams,
    costs: BacktestCostParams,
    startDate: string,
    endDate: string,
  ): Promise<{
    trades: SimulatedTrade[];
    metrics: PerformanceMetrics;
    equityCurve: EquityCurvePoint[];
  }> {
    const runner = new BacktestRunnerService(priceAdapter, this.calendar, this.constraint);
    const trades = await runner.run(signals, strategy, costs, startDate, endDate);
    const metrics = this.performance.calculate(
      trades,
      strategy.initialCapital,
      startDate,
      endDate,
    );
    const equityCurve = buildEquityCurve(trades, strategy.initialCapital, startDate);
    return { trades, metrics, equityCurve };
  }

  /** 최신 완료 트랙레코드 조회(없으면 null) */
  async getLatest(): Promise<BacktestTrackRecord | null> {
    const run = await this.prisma.backtestRun.findFirst({
      where: { status: 'COMPLETED', universe: REPLAY_UNIVERSE },
      orderBy: { completedAt: 'desc' },
    });
    return run ? this.toTrackRecord(run) : null;
  }

  /** id 로 트랙레코드 조회 */
  async getById(id: string): Promise<BacktestTrackRecord> {
    const run = await this.prisma.backtestRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`백테스트 실행 없음: ${id}`);
    return this.toTrackRecord(run);
  }

  private toTrackRecord(run: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    status: string;
    strategyParams: unknown;
    commissionRate: unknown;
    taxRate: unknown;
    slippagePct: unknown;
    summary: unknown;
    completedAt: Date | null;
  }): BacktestTrackRecord {
    const strategy = run.strategyParams as StrategyParams;
    const summary = (run.summary ?? {}) as {
      metrics?: PerformanceMetrics;
      equityCurve?: EquityCurvePoint[];
      totalSignals?: number;
    };
    return {
      runId: run.id,
      name: run.name,
      startDate: this.calendar.formatDate(run.startDate),
      endDate: this.calendar.formatDate(run.endDate),
      initialCapital: strategy?.initialCapital ?? DEFAULT_REPLAY_STRATEGY.initialCapital,
      status: run.status,
      totalSignals: summary.totalSignals ?? 0,
      metrics: summary.metrics as PerformanceMetrics,
      equityCurve: summary.equityCurve ?? [],
      strategy,
      costs: {
        commissionRate: Number(run.commissionRate),
        taxRate: Number(run.taxRate),
        slippagePct: Number(run.slippagePct),
      },
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    };
  }

  /**
   * SimulatedTrade[] → BacktestTrade 영속(createMany).
   *
   * DAR-390 — null/NaN/Infinity 안전성(이중 방어):
   *  - 러너가 가격 결측·이상치 신호를 1차 제외하지만, 어떤 경로로든 진입 필수 수치
   *    (entryPrice/entryShares/entryValue 등)가 유한·양수가 아닌 트레이드가 들어오면
   *    Prisma 가 createMany 전체를 거부해 replay 가 500 으로 깨진다. 그런 트레이드는
   *    여기서 graceful 하게 제외하고 제외 건수를 로그로 남긴다(부분 결측이 전체 실패로
   *    번지지 않게).
   *  - 선택(nullable) 수치 필드는 undefined/비유한 값을 null 로 정규화한다.
   *  - returnPct 는 컬럼 정밀도 Decimal(8,4) 한계(±9999.9999)를 넘으면 Prisma 가 거부하므로
   *    표현 가능 범위로 클램프한다(극단치 보존보다 영속 성공 우선).
   */
  private async persistTrades(runId: string, trades: SimulatedTrade[]): Promise<void> {
    if (trades.length === 0) return;

    const rows: Prisma.BacktestTradeCreateManyInput[] = [];
    let skipped = 0;
    for (const t of trades) {
      // 진입 필수 수치 — 유한·양수가 아니면 영속 불가 트레이드로 제외
      if (
        !isFinitePositive(t.entryPrice) ||
        !isFinitePositive(t.entryShares) ||
        !isFinitePositive(t.entryValue) ||
        !Number.isFinite(t.buyScore)
      ) {
        skipped += 1;
        this.logger.warn(
          `[DAR-390] 영속 제외(가격 결측/이상치) [${t.stockCode}] rcpNo=${t.rcpNo} ` +
            `entryPrice=${t.entryPrice} entryShares=${t.entryShares} entryValue=${t.entryValue}`,
        );
        continue;
      }

      rows.push({
        backtestRunId: runId,
        disclosureRcpNo: t.rcpNo,
        corpCode: t.corpCode,
        stockCode: t.stockCode,
        eventType: t.eventType,
        persona: t.persona,
        disclosureAt: t.disclosureAt,
        isAfterMarket: t.isAfterMarket,
        entryDate: t.entryDate,
        entryPrice: t.entryPrice,
        entryShares: Math.round(t.entryShares),
        entryValue: t.entryValue,
        exitDate: t.exitDate ?? null,
        exitPrice: finiteOrNull(t.exitPrice),
        exitShares:
          t.exitShares != null && Number.isFinite(t.exitShares) ? Math.round(t.exitShares) : null,
        exitValue: finiteOrNull(t.exitValue),
        exitReason: t.exitReason ?? null,
        commission: finiteOr(t.commission, 0),
        tax: finiteOr(t.tax, 0),
        slippage: finiteOr(t.slippage, 0),
        grossPnl: finiteOrNull(t.grossPnl),
        netPnl: finiteOrNull(t.netPnl),
        returnPct: clampReturnPct(t.returnPct),
        holdDays:
          t.holdDays != null && Number.isFinite(t.holdDays) ? Math.round(t.holdDays) : null,
        wasLimitUp: t.wasLimitUp,
        wasLimitDown: t.wasLimitDown,
        wasTradingSuspended: t.wasTradingSuspended,
        wasAdminStock: t.wasAdminStock,
        isPartialFill: t.isPartialFill,
        fillRate: finiteOrNull(t.fillRate),
        lowLiquidityFlag: t.lowLiquidityFlag,
        buyScoreSnapshot: Math.round(t.buyScore),
      });
    }

    if (skipped > 0) {
      this.logger.warn(
        `[DAR-390] 가격 결측/이상치로 ${skipped}건 영속 제외 (전체 ${trades.length}건)`,
      );
    }
    if (rows.length === 0) return;
    await this.prisma.backtestTrade.createMany({ data: rows });
  }

  private assertDate(value: string, field: string): void {
    if (!ISO_DATE.test(value)) {
      throw new BadRequestException(`${field} 는 YYYY-MM-DD 형식이어야 합니다: ${value}`);
    }
  }
}
