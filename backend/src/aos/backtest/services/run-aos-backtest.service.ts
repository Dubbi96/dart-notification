import { Injectable } from '@nestjs/common';
import type { JsonObject } from '@dart-notification/aos-rule-engine';

import { PrismaService } from '../../../prisma/prisma.service';
import { BacktestRunnerService } from '../../../engine3-quant-market/backtest/backtest-runner.service';
import { MarketCalendarService } from '../../../engine3-quant-market/backtest/constraint/market-calendar.service';
import { PriceConstraintService } from '../../../engine3-quant-market/backtest/constraint/price-constraint.service';
import { PerformanceCalculatorService } from '../../../engine3-quant-market/backtest/metrics/performance-calculator.service';
import {
  buildAcceptanceRecords,
  buildAttributions,
  hashBacktestReceipt,
  hashDatasetManifest,
  jsonSafe,
  validateWalkForwardWindows,
} from '../domain/versioned-backtest';
import {
  AosBacktestDomainError,
  AosBacktestExecutionInput,
  BacktestWindowRecord,
  CanonicalAosBacktestRecord,
} from '../domain/versioned-backtest.types';
import { RecordAosBacktestRunService } from './record-aos-backtest-run.service';

const BACKTESTABLE_VERSION_STATES = new Set([
  'VALIDATED',
  'BACKTESTED',
  'APPROVAL_PENDING',
  'APPROVED',
  'SCHEDULED',
  'ACTIVE',
  'SUPERSEDED',
  'ROLLED_BACK',
  'RETIRED',
]);

@Injectable()
export class RunAosBacktestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: MarketCalendarService,
    private readonly constraint: PriceConstraintService,
    private readonly performance: PerformanceCalculatorService,
    private readonly recorder: RecordAosBacktestRunService,
  ) {}

  async execute(input: AosBacktestExecutionInput) {
    const [strategyVersion, riskPolicyVersion] = await Promise.all([
      this.prisma.strategyVersion.findUnique({
        where: { id: input.strategyVersionId },
        select: { id: true, status: true, configHash: true },
      }),
      this.prisma.riskPolicyVersion.findUnique({
        where: { id: input.riskPolicyVersionId },
        select: { id: true, status: true, configHash: true },
      }),
    ]);
    if (!strategyVersion || !BACKTESTABLE_VERSION_STATES.has(strategyVersion.status)) {
      throw new AosBacktestDomainError('StrategyVersion is missing or not validated for backtest.');
    }
    if (!riskPolicyVersion || !BACKTESTABLE_VERSION_STATES.has(riskPolicyVersion.status)) {
      throw new AosBacktestDomainError(
        'RiskPolicyVersion is missing or not validated for backtest.',
      );
    }
    if (
      input.runType === 'VERSIONED_EVALUATOR' &&
      input.signals.some((signal) => !signal.signalDecisionId)
    ) {
      throw new AosBacktestDomainError(
        'VERSIONED_EVALUATOR run requires a SignalDecision reference for every signal.',
      );
    }

    const windows = validateWalkForwardWindows(input.windows, input.startDate, input.endDate);
    if (
      input.runType === 'VERSIONED_EVALUATOR' &&
      !(['TRAIN', 'VALIDATION', 'TEST'] as const).every((role) =>
        windows.some((window) => window.role === role),
      )
    ) {
      throw new AosBacktestDomainError(
        'VERSIONED_EVALUATOR run requires TRAIN, VALIDATION, and TEST windows.',
      );
    }
    const datasetHash = hashDatasetManifest(input.dataset);
    const runner = new BacktestRunnerService(input.priceDataPort, this.calendar, this.constraint);
    const trades = await runner.run(
      input.signals,
      input.strategy,
      input.costs,
      input.startDate,
      input.endDate,
    );
    const metrics = this.performance.calculate(
      trades,
      input.strategy.initialCapital,
      input.startDate,
      input.endDate,
    );
    const windowRecords: BacktestWindowRecord[] = windows.map((window) => ({
      ...window,
      metrics: this.performance.calculate(
        trades.filter((trade) => {
          const date = this.calendar.formatDate(trade.entryDate);
          return date >= window.startDate && date <= window.endDate;
        }),
        input.strategy.initialCapital,
        window.startDate,
        window.endDate,
      ),
    }));
    const acceptance = buildAcceptanceRecords(
      input.acceptancePolicy,
      metrics,
      windowRecords,
      trades,
      input.sensitivity,
    );
    const attributions = buildAttributions(trades);
    const receiptPayload = {
      schemaVersion: 'aos-backtest-receipt.v1',
      runType: input.runType,
      strategyVersion: { id: strategyVersion.id, hash: strategyVersion.configHash },
      riskPolicyVersion: { id: riskPolicyVersion.id, hash: riskPolicyVersion.configHash },
      dataset: {
        version: input.dataset.version,
        hash: datasetHash,
        asOf: input.dataset.asOf.toISOString(),
      },
      evaluatorVersion: input.evaluatorVersion,
      range: { startDate: input.startDate, endDate: input.endDate },
      strategy: jsonSafe(input.strategy),
      costs: jsonSafe(input.costs),
      metrics: jsonSafe(metrics),
      windows: jsonSafe(windowRecords),
      sensitivity: jsonSafe(input.sensitivity),
      acceptance: jsonSafe(acceptance),
      trades: trades.map((trade) => ({
        signalDecisionId: trade.signalDecisionId ?? null,
        stockCode: trade.stockCode,
        entryDate: trade.entryDate.toISOString(),
        exitDate: trade.exitDate?.toISOString() ?? null,
        netPnl: trade.netPnl ?? null,
        maePct: trade.maxAdverseExcursionPct ?? null,
        mfePct: trade.maxFavorableExcursionPct ?? null,
      })),
    } as JsonObject;
    const receiptHash = hashBacktestReceipt(receiptPayload);
    const record: CanonicalAosBacktestRecord = {
      replayKey: `aos-backtest:${receiptHash}`,
      runType: input.runType,
      strategyVersionId: strategyVersion.id,
      strategyContentHash: strategyVersion.configHash,
      riskPolicyVersionId: riskPolicyVersion.id,
      riskPolicyContentHash: riskPolicyVersion.configHash,
      datasetVersion: input.dataset.version,
      datasetHash,
      evaluatorVersion: input.evaluatorVersion,
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: input.strategy.initialCapital,
      strategy: input.strategy,
      costs: input.costs,
      metrics,
      windows: Object.freeze(windowRecords),
      trades: Object.freeze(trades),
      sensitivity: Object.freeze([...input.sensitivity]),
      attributions,
      acceptanceStatus: acceptance.status,
      acceptance: acceptance.records,
      receiptHash,
    };
    return this.recorder.record(record);
  }
}
