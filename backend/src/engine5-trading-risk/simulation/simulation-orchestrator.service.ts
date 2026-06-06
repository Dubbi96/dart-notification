// 일일 모의운용 오케스트레이터 (M10, DAR-40)
// 매수 후보 수집 → 모의매수 → 일일 시가평가/스냅샷 → Exit 평가/모의매도 → 리스크 스냅샷.
// AI 금지영역: 전 과정 순수 Rule. engine2(AI) import 0. Exit Score는 engine4 순수 계산기 재사용.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { calculateExitScore } from '../../engine4-portfolio-exit/domain/exit-score.calculator';
import {
  PositionSnapshot,
  TechnicalSnapshot,
} from '../../engine4-portfolio-exit/domain/exit-engine.types';
import {
  DEFAULT_SIMULATION_CONFIG,
  SimulationConfig,
} from './domain/simulation.config';
import {
  selectBuyCandidates,
  shouldExit,
  sizePosition,
} from './domain/position-sizing';
import {
  DailySimulationResult,
  OpenPositionView,
} from './domain/simulation.types';
import { ISimulationPort, SIMULATION_PORT } from './ports/simulation.port';

/** YYYYMMDD → Date (로컬 자정) */
export function parseTradeDate(tradeDate: string): Date {
  const y = Number(tradeDate.slice(0, 4));
  const m = Number(tradeDate.slice(4, 6));
  const d = Number(tradeDate.slice(6, 8));
  return new Date(y, m - 1, d);
}

@Injectable()
export class SimulationOrchestratorService {
  private readonly logger = new Logger(SimulationOrchestratorService.name);

  constructor(
    @Inject(SIMULATION_PORT) private readonly port: ISimulationPort,
  ) {}

  /**
   * 1일치 모의운용 시뮬레이션 실행.
   * 순서: 보유 평가/스냅샷 → Exit 청산 → 신규 매수 → 리스크 스냅샷.
   */
  async runDailySimulation(
    tradeDate: string,
    portfolioIdArg?: string,
    config: SimulationConfig = DEFAULT_SIMULATION_CONFIG,
  ): Promise<DailySimulationResult> {
    const portfolioId =
      portfolioIdArg ?? (await this.port.resolveSimPortfolioId());
    const startState = await this.port.getCumulativeState(portfolioId);
    const sizingBase =
      startState.currentValue > 0 ? startState.currentValue : config.initialCapital;
    const tradeDateObj = parseTradeDate(tradeDate);

    this.logger.log(
      `[Sim] ${tradeDate} 시작 portfolio=${portfolioId} 평가기준액=${Math.round(sizingBase)}`,
    );

    // (b)(c) 보유 포지션 일일 시가평가 + Exit 평가
    const openPositions = await this.port.getOpenPositions(portfolioId);
    let evaluated = 0;
    let snapshotted = 0;
    let exited = 0;
    const remaining: OpenPositionView[] = [];
    const priceByStock = new Map<string, number>();

    for (const pos of openPositions) {
      evaluated++;
      const close =
        (await this.port.getLatestClose(pos.stockCode, tradeDate)) ??
        pos.entryPrice;
      priceByStock.set(pos.stockCode, close);

      const exitResult = this.evaluateExit(pos, close, sizingBase, config);
      const positionValue = close * pos.quantity;
      const cost = pos.entryPrice * pos.quantity;
      const unrealizedPnl = positionValue - cost;
      const unrealizedPnlPct = cost > 0 ? (unrealizedPnl / cost) * 100 : 0;

      await this.port.saveDailySnapshot({
        positionId: pos.positionId,
        snapshotDate: tradeDate,
        closePrice: close,
        quantity: pos.quantity,
        positionValue,
        unrealizedPnl,
        unrealizedPnlPct,
        exitScore: exitResult.exitScore,
        exitAction: exitResult.exitAction,
      });
      snapshotted++;

      if (shouldExit(exitResult.exitAction)) {
        await this.port.closePosition({
          position: pos,
          exitPrice: close,
          exitDate: tradeDateObj,
          exitScore: exitResult.exitScore,
          exitAction: exitResult.exitAction,
          triggerType: exitResult.primaryTrigger,
          triggerTypes: exitResult.triggerTypes,
        });
        exited++;
        this.logger.log(
          `[Sim] 청산 ${pos.stockCode} score=${exitResult.exitScore} action=${exitResult.exitAction}`,
        );
      } else {
        remaining.push(pos);
      }
    }

    // (a) 신규 모의매수 (Exit로 비워진 슬롯 반영)
    const heldStockCodes = remaining.map((p) => p.stockCode);
    const candidates = await this.port.getBuyCandidates(tradeDate);
    const selected = selectBuyCandidates(candidates, heldStockCodes, config);
    let bought = 0;
    let skipped = 0;

    for (const c of selected) {
      const shares = sizePosition(c.entryPrice, sizingBase, config);
      if (shares <= 0) {
        skipped++;
        continue;
      }
      await this.port.openPosition(portfolioId, {
        candidate: c,
        shares,
        stopLossPct: config.defaultStopLossPct,
        takeProfitPct: config.defaultTakeProfitPct,
        maxHoldDays: config.defaultMaxHoldDays,
        entryDate: tradeDateObj,
      });
      priceByStock.set(c.stockCode, c.entryPrice);
      bought++;
      this.logger.log(`[Sim] 매수 ${c.stockCode} ${shares}주 @${c.entryPrice}`);
    }

    // DAR-109: 신호→진입 퍼널 계측(졸업 표본 누적 모니터링).
    // 당일 생성 신호 수 → 진입 후보 통과 수(selected) → 실제 체결 수(bought).
    // 멱등 저장(portfolioId,tradeDate) — 같은 거래일 재실행은 최신 값으로 갱신.
    const signalsGenerated = await this.port.getDailySignalCount(tradeDate);
    await this.port.saveFunnelSnapshot({
      portfolioId,
      tradeDate,
      signalsGenerated,
      candidatesPassed: selected.length,
      filled: bought,
    });

    // (d) 포트폴리오 리스크 스냅샷
    const finalState = await this.port.getCumulativeState(portfolioId);
    const finalOpen = await this.port.getOpenPositions(portfolioId);
    const { unrealizedPnl, topPositionValue, holdingsValue } =
      this.summarizeHoldings(finalOpen, priceByStock);
    const totalValue = finalState.cash + holdingsValue;
    const unrealizedPnlPct =
      holdingsValue - unrealizedPnl > 0
        ? (unrealizedPnl / (holdingsValue - unrealizedPnl)) * 100
        : 0;
    const topPositionPct =
      totalValue > 0 ? (topPositionValue / totalValue) * 100 : 0;

    await this.port.saveRiskSnapshot({
      portfolioId,
      snapshotDate: tradeDate,
      totalValue,
      cashAmount: finalState.cash,
      unrealizedPnl,
      unrealizedPnlPct,
      topPositionPct,
      openPositionCount: finalOpen.length,
    });

    const result: DailySimulationResult = {
      tradeDate,
      portfolioId,
      evaluated,
      snapshotted,
      exited,
      bought,
      skipped,
      openPositionCountAfter: finalOpen.length,
      totalValueAfter: totalValue,
      signalsGenerated,
      candidatesPassed: selected.length,
    };
    this.logger.log(
      `[Sim] ${tradeDate} 완료 매수=${bought} 청산=${exited} 스냅샷=${snapshotted} 보유=${finalOpen.length} 평가액=${Math.round(totalValue)} 퍼널(신호=${signalsGenerated}→후보=${selected.length}→체결=${bought})`,
    );
    return result;
  }

  /** Exit Score 계산 (engine4 순수 계산기 재사용, 보수적 기본 스냅샷). */
  private evaluateExit(
    pos: OpenPositionView,
    close: number,
    portfolioTotalValue: number,
    _config: SimulationConfig,
  ) {
    const positionSnapshot: PositionSnapshot = {
      id: pos.positionId,
      corpCode: pos.corpCode,
      stockCode: pos.stockCode,
      entryPrice: pos.entryPrice,
      quantity: pos.quantity,
      entryAmount: pos.entryPrice * pos.quantity,
      currentPrice: close,
      highestPrice: Math.max(pos.highestPrice ?? close, close),
      stopLossPct: pos.stopLossPct,
      takeProfitPct: pos.takeProfitPct,
      maxHoldDays: pos.maxHoldDays,
      entryDate: pos.entryDate,
      portfolioTotalValue,
      portfolioMaxSinglePositionPct: 10,
      portfolioMaxSectorPct: 30,
      portfolioMaxDailyLossPct: 2,
      portfolioDailyLossPct: null,
    };
    const technicalSnapshot: TechnicalSnapshot = {
      closePrice: close,
      openPrice: null,
      ma5: null,
      ma20: null,
      low20: null,
      vwap: null,
      atr14: null,
      volumeRatio3d: null,
      excessReturn5d: null,
      avgVolumeRatio5d: null,
    };
    return calculateExitScore(positionSnapshot, technicalSnapshot, null, []);
  }

  private summarizeHoldings(
    positions: OpenPositionView[],
    priceByStock: Map<string, number>,
  ): { unrealizedPnl: number; topPositionValue: number; holdingsValue: number } {
    let unrealizedPnl = 0;
    let topPositionValue = 0;
    let holdingsValue = 0;
    for (const p of positions) {
      const price = priceByStock.get(p.stockCode) ?? p.entryPrice;
      const value = price * p.quantity;
      holdingsValue += value;
      unrealizedPnl += value - p.entryPrice * p.quantity;
      if (value > topPositionValue) topPositionValue = value;
    }
    return { unrealizedPnl, topPositionValue, holdingsValue };
  }
}
