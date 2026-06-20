import { Injectable, Logger } from '@nestjs/common';
import {
  DisclosureSignal,
  StrategyParams,
  BacktestCostParams,
  SimulatedTrade,
  ExitReasonType,
} from './ports/backtest.types';
import { PriceDataPort } from './ports/price-data.port';
import { MarketCalendarService } from './constraint/market-calendar.service';
import { PriceConstraintService } from './constraint/price-constraint.service';

/**
 * 백테스트 실행 엔진 (순수 Rule)
 *
 * lookahead bias 방지 설계:
 * 1. 각 시점 의사결정에 그 시점까지의 데이터만 사용
 * 2. 공시 당일 종가 진입 절대 금지 — 항상 다음 거래일 시가 진입
 * 3. 미래 가격 시퀀스에 접근 불가 — 진입 시 exitDate 미리 계산 금지
 * 4. 청산 판정은 해당 일봉 데이터를 받은 시점에만 수행
 *
 * AI 금지영역: 이 파일의 모든 로직은 순수 Rule. AI 개입 절대 금지.
 */
@Injectable()
export class BacktestRunnerService {
  private readonly logger = new Logger(BacktestRunnerService.name);

  constructor(
    private readonly priceDataPort: PriceDataPort,
    private readonly calendar: MarketCalendarService,
    private readonly constraint: PriceConstraintService,
  ) {}

  /**
   * 백테스트 실행
   * @param signals 매수 신호 목록 (시간순 정렬)
   * @param strategy 전략 파라미터
   * @param costs 비용 파라미터
   * @param startDate 백테스트 시작일 YYYY-MM-DD
   * @param endDate 백테스트 종료일 YYYY-MM-DD
   */
  async run(
    signals: DisclosureSignal[],
    strategy: StrategyParams,
    costs: BacktestCostParams,
    startDate: string,
    endDate: string,
  ): Promise<SimulatedTrade[]> {
    const tradingDays = await this.priceDataPort.getTradingDays(startDate, endDate);
    if (tradingDays.length === 0) {
      this.logger.warn('거래일 데이터 없음');
      return [];
    }

    // 신호 필터: 전략 조건 충족 여부
    const qualifiedSignals = signals.filter((s) => {
      if (s.buyScore < strategy.minBuyScore) return false;
      if (strategy.eventTypes?.length && !strategy.eventTypes.includes(s.eventType)) return false;
      if (strategy.personas?.length && !strategy.personas.includes(s.persona)) return false;
      return true;
    });

    const trades: SimulatedTrade[] = [];
    // 활성 포지션 추적 (corpCode → SimulatedTrade)
    const activePositions = new Map<string, SimulatedTrade>();

    for (const day of tradingDays) {
      // 1. 해당일 신규 공시 신호 처리 (lookahead: disclosureAt.date <= day)
      const todaySignals = qualifiedSignals.filter((s) => {
        const disclosureDate = this.calendar.formatDate(s.disclosureAt);
        // 진입 결정: 공시 당일 다음 거래일이 today인 신호만 처리
        const entryDate = this.calendar.getEntryDate(disclosureDate, tradingDays);
        return entryDate === day;
      });

      // 2. 신규 진입 처리
      for (const signal of todaySignals) {
        // 최대 포지션 수 제한
        if (activePositions.size >= strategy.maxPositions) break;
        // 동일 종목 중복 진입 방지
        if (activePositions.has(signal.corpCode)) continue;

        const prices = await this.priceDataPort.getDailyPrices(signal.stockCode, day, day);
        const dayPrice = prices[0];
        if (!dayPrice) continue;

        // 현실 제약 체크
        if (!this.constraint.canEnter(dayPrice)) {
          this.logger.debug(`진입 불가 [${signal.stockCode}] ${day}: 거래정지/상한가/관리종목`);
          continue;
        }

        // 가격 결측·이상치 가드(DAR-390): 시가가 유한·양수가 아니면 진입 불가.
        // 백필 일봉에 0/음수/결측이 섞이면 0 으로 나눠 shares=Infinity·entryValue=NaN 이
        // 되어 영속 시 Prisma 가 거부(500)된다 → 신호를 graceful 하게 제외하고 로그만 남긴다.
        const rawEntryPrice = dayPrice.open;
        if (!Number.isFinite(rawEntryPrice) || rawEntryPrice <= 0) {
          this.logger.debug(
            `진입 불가 [${signal.stockCode}] ${day}: 시가 결측/이상치(open=${rawEntryPrice})`,
          );
          continue;
        }

        const disclosureDate = this.calendar.formatDate(signal.disclosureAt);
        const isAfterMarket = this.calendar.isAfterMarket(signal.disclosureAt);

        // 슬리피지 반영 진입가 (시가 기준)
        const entryPrice = this.constraint.applySlippage(rawEntryPrice, costs.slippagePct, true);

        // 포지션 크기 결정
        const capital = strategy.initialCapital;
        const positionSize = capital / strategy.maxPositions;
        const rawShares = Math.floor(positionSize / entryPrice);
        if (rawShares <= 0) continue;

        // 부분체결 시뮬
        const fillRate = this.constraint.simulateFillRate(dayPrice, rawShares);
        const entryShares = Math.floor(rawShares * fillRate);
        if (entryShares <= 0) continue;

        const entryValue = entryShares * entryPrice;
        const commission = this.constraint.calcCommission(entryValue, costs.commissionRate);

        const trade: SimulatedTrade = {
          rcpNo: signal.rcpNo,
          corpCode: signal.corpCode,
          stockCode: signal.stockCode,
          eventType: signal.eventType,
          persona: signal.persona,
          buyScore: signal.buyScore,

          disclosureAt: signal.disclosureAt,
          isAfterMarket,
          entryDate: this.calendar.parseDate(day),
          entryPrice,
          entryShares,
          entryValue,

          commission,
          tax: 0,
          slippage: entryValue * costs.slippagePct,

          wasLimitUp: dayPrice.isLimitUp ?? false,
          wasLimitDown: dayPrice.isLimitDown ?? false,
          wasTradingSuspended: dayPrice.isTradingSuspended ?? false,
          wasAdminStock: dayPrice.isAdminStock ?? false,
          isPartialFill: fillRate < 1,
          fillRate: fillRate < 1 ? fillRate : undefined,
          lowLiquidityFlag: this.constraint.isLowLiquidity(dayPrice),
        };

        activePositions.set(signal.corpCode, trade);
      }

      // 3. 활성 포지션 청산 판정 (해당일 종가/고가/저가 기준)
      const exitRules = strategy.exitRules;
      for (const [corpCode, trade] of Array.from(activePositions.entries())) {
        const prices = await this.priceDataPort.getDailyPrices(trade.stockCode, day, day);
        const dayPrice = prices[0];
        if (!dayPrice) continue;
        // 가격 결측·이상치 가드(DAR-390): 종가가 유한·양수가 아니면 해당일 청산 판정 보류
        // (데이터 없는 날과 동일 취급 → 포지션 유지). returnPct=NaN 으로 인한 오판/오염 방지.
        if (!Number.isFinite(dayPrice.close) || dayPrice.close <= 0) continue;

        const entryDateStr = this.calendar.formatDate(trade.entryDate);
        const holdDays = this.calendar.daysBetween(entryDateStr, day);
        const currentPrice = dayPrice.close;
        const returnPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;

        let exitReason: ExitReasonType | undefined;

        // 청산 조건 판정 (순서: 손절 > 익절 > 기간초과)
        if (returnPct <= exitRules.stopLossPct) {
          exitReason = 'STOP_LOSS';
        } else if (returnPct >= exitRules.takeProfitPct) {
          exitReason = 'TAKE_PROFIT';
        } else if (
          exitRules.trailingStopPct !== undefined &&
          this.isTrailingStopTriggered(trade, dayPrice.low, exitRules.trailingStopPct)
        ) {
          exitReason = 'TRAILING_STOP';
        } else if (holdDays >= exitRules.maxHoldDays) {
          exitReason = 'MAX_HOLD_DAYS';
        } else if (day === endDate) {
          exitReason = 'FORCE_EXIT';
        }

        if (!exitReason) continue;

        // 청산 처리
        const exitPriceRaw =
          exitReason === 'STOP_LOSS' ? dayPrice.low : currentPrice;
        const exitPrice = this.constraint.applySlippage(exitPriceRaw, costs.slippagePct, false);
        const exitShares = trade.entryShares;
        const exitValue = exitShares * exitPrice;
        const exitCommission = this.constraint.calcCommission(exitValue, costs.commissionRate);
        const exitTax = this.constraint.calcTax(exitValue, costs.taxRate);
        const exitSlippage = exitValue * costs.slippagePct;

        const grossPnl = exitValue - trade.entryValue;
        const totalCosts = trade.commission + exitCommission + exitTax + trade.slippage + exitSlippage;
        const netPnl = grossPnl - totalCosts;
        const netReturnPct = (netPnl / trade.entryValue) * 100;

        const closedTrade: SimulatedTrade = {
          ...trade,
          exitDate: this.calendar.parseDate(day),
          exitPrice,
          exitShares,
          exitValue,
          exitReason,
          commission: trade.commission + exitCommission,
          tax: exitTax,
          slippage: trade.slippage + exitSlippage,
          grossPnl,
          netPnl,
          returnPct: netReturnPct,
          holdDays,
        };

        trades.push(closedTrade);
        activePositions.delete(corpCode);
      }
    }

    // 미청산 포지션 강제 청산
    for (const trade of activePositions.values()) {
      const lastDay = tradingDays[tradingDays.length - 1];
      const prices = await this.priceDataPort.getDailyPrices(trade.stockCode, lastDay, lastDay);
      const dayPrice = prices[0];
      // 종가 결측·이상치(DAR-390)도 가격 부재와 동일 취급 → 미청산(미실현)으로 보존.
      if (!dayPrice || !Number.isFinite(dayPrice.close) || dayPrice.close <= 0) {
        trades.push(trade);
        continue;
      }

      const exitPrice = this.constraint.applySlippage(dayPrice.close, costs.slippagePct, false);
      const exitShares = trade.entryShares;
      const exitValue = exitShares * exitPrice;
      const exitCommission = this.constraint.calcCommission(exitValue, costs.commissionRate);
      const exitTax = this.constraint.calcTax(exitValue, costs.taxRate);
      const exitSlippage = exitValue * costs.slippagePct;

      const entryDateStr = this.calendar.formatDate(trade.entryDate);
      const holdDays = this.calendar.daysBetween(entryDateStr, lastDay);
      const grossPnl = exitValue - trade.entryValue;
      const totalCosts = trade.commission + exitCommission + exitTax + trade.slippage + exitSlippage;
      const netPnl = grossPnl - totalCosts;

      trades.push({
        ...trade,
        exitDate: this.calendar.parseDate(lastDay),
        exitPrice,
        exitShares,
        exitValue,
        exitReason: 'FORCE_EXIT',
        commission: trade.commission + exitCommission,
        tax: exitTax,
        slippage: trade.slippage + exitSlippage,
        grossPnl,
        netPnl,
        returnPct: (netPnl / trade.entryValue) * 100,
        holdDays,
      });
    }

    return trades;
  }

  /** 트레일링 스탑 판정 — 최고가 대비 하락률 */
  private isTrailingStopTriggered(
    trade: SimulatedTrade,
    currentLow: number,
    trailingStopPct: number,
  ): boolean {
    // 단순 구현: 진입가 대비 하락폭
    const dropFromEntry = ((currentLow - trade.entryPrice) / trade.entryPrice) * 100;
    return dropFromEntry <= trailingStopPct;
  }
}
