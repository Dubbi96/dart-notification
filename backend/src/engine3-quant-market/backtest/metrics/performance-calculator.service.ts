import { Injectable } from '@nestjs/common';
import {
  SimulatedTrade,
  PerformanceMetrics,
  EventTypeMetrics,
  WorstTrade,
  RealWorldGate,
} from '../ports/backtest.types';
import { MarketCalendarService } from '../constraint/market-calendar.service';

@Injectable()
export class PerformanceCalculatorService {
  constructor(private readonly calendar: MarketCalendarService) {}

  calculate(
    trades: SimulatedTrade[],
    initialCapital: number,
    startDate: string,
    endDate: string,
  ): PerformanceMetrics {
    const closedTrades = trades.filter((t) => t.netPnl !== undefined && t.exitDate);

    const wonTrades = closedTrades.filter((t) => (t.netPnl ?? 0) > 0);
    const lostTrades = closedTrades.filter((t) => (t.netPnl ?? 0) <= 0);

    const totalNetPnl = closedTrades.reduce((s, t) => s + (t.netPnl ?? 0), 0);
    const totalReturn = initialCapital > 0 ? (totalNetPnl / initialCapital) * 100 : 0;

    const holdDays = this.calendar.daysBetween(startDate, endDate);
    const years = holdDays / 365;
    const annualizedReturn =
      years > 0 && totalReturn > -100
        ? (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100
        : 0;

    const winRate = closedTrades.length > 0 ? (wonTrades.length / closedTrades.length) * 100 : 0;

    const avgWin =
      wonTrades.length > 0
        ? wonTrades.reduce((s, t) => s + (t.returnPct ?? 0), 0) / wonTrades.length
        : 0;

    const avgLoss =
      lostTrades.length > 0
        ? lostTrades.reduce((s, t) => s + (t.returnPct ?? 0), 0) / lostTrades.length
        : 0;

    const grossWin = wonTrades.reduce((s, t) => s + (t.netPnl ?? 0), 0);
    const grossLoss = Math.abs(lostTrades.reduce((s, t) => s + (t.netPnl ?? 0), 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

    const mdd = this.calcMdd(closedTrades, initialCapital);
    const sharpe = this.calcSharpe(closedTrades, initialCapital);

    const avgHoldDays =
      closedTrades.length > 0
        ? closedTrades.reduce((s, t) => s + (t.holdDays ?? 0), 0) / closedTrades.length
        : 0;

    const monthlyReturns = this.calcMonthlyReturns(closedTrades, initialCapital);
    const byEventType = this.groupMetrics(closedTrades, (t) => t.eventType);
    const byPersona = this.groupMetrics(closedTrades, (t) => t.persona);
    const worstTrades = this.getWorstTrades(closedTrades, 10);

    const realWorldGate = this.checkRealWorldGate(
      closedTrades,
      mdd,
      totalReturn,
      monthlyReturns,
      startDate,
      endDate,
    );

    return {
      totalReturn,
      annualizedReturn,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      mdd,
      sharpe,
      totalTrades: closedTrades.length,
      wonTrades: wonTrades.length,
      lostTrades: lostTrades.length,
      avgHoldDays,
      monthlyReturns,
      byEventType,
      byPersona,
      worstTrades,
      realWorldGate,
      passedGate: Object.values(realWorldGate).every(Boolean),
    };
  }

  /** 최대낙폭(MDD) 계산 */
  private calcMdd(trades: SimulatedTrade[], initialCapital: number): number {
    let capital = initialCapital;
    let peak = initialCapital;
    let mdd = 0;

    // 진입일 기준 정렬
    const sorted = [...trades].sort(
      (a, b) => (a.exitDate?.getTime() ?? 0) - (b.exitDate?.getTime() ?? 0),
    );

    for (const t of sorted) {
      capital += t.netPnl ?? 0;
      if (capital > peak) peak = capital;
      const drawdown = peak > 0 ? ((capital - peak) / peak) * 100 : 0;
      if (drawdown < mdd) mdd = drawdown;
    }
    return mdd;
  }

  /** Sharpe Ratio (연환산, 무위험수익률 0 가정) */
  private calcSharpe(trades: SimulatedTrade[], initialCapital: number): number {
    if (trades.length < 2 || initialCapital <= 0) return 0;

    const returns = trades.map((t) => (t.returnPct ?? 0) / 100);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // 연환산 (거래당 평균 hold일 기준)
    const avgHold = trades.reduce((s, t) => s + (t.holdDays ?? 5), 0) / trades.length;
    const annualFactor = Math.sqrt(252 / Math.max(avgHold, 1));

    return (mean / stdDev) * annualFactor;
  }

  /** 월별 수익 집계 */
  private calcMonthlyReturns(
    trades: SimulatedTrade[],
    initialCapital: number,
  ): Record<string, number> {
    const monthly: Record<string, number> = {};
    for (const t of trades) {
      if (!t.exitDate || t.netPnl === undefined) continue;
      const key = this.calendar.toMonthKey(this.calendar.formatDate(t.exitDate));
      monthly[key] = (monthly[key] ?? 0) + t.netPnl;
    }
    // 절대금액 → %
    return Object.fromEntries(
      Object.entries(monthly).map(([k, v]) => [k, (v / initialCapital) * 100]),
    );
  }

  /** 그룹별 성과 집계 */
  private groupMetrics(
    trades: SimulatedTrade[],
    keyFn: (t: SimulatedTrade) => string,
  ): Record<string, EventTypeMetrics> {
    const groups: Record<string, SimulatedTrade[]> = {};
    for (const t of trades) {
      const key = keyFn(t);
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }

    return Object.fromEntries(
      Object.entries(groups).map(([key, ts]) => {
        const won = ts.filter((t) => (t.netPnl ?? 0) > 0);
        const avgReturn = ts.length > 0
          ? ts.reduce((s, t) => s + (t.returnPct ?? 0), 0) / ts.length
          : 0;
        const totalReturn = ts.reduce((s, t) => s + (t.returnPct ?? 0), 0);
        return [
          key,
          {
            trades: ts.length,
            winRate: ts.length > 0 ? (won.length / ts.length) * 100 : 0,
            avgReturn,
            totalReturn,
          } satisfies EventTypeMetrics,
        ];
      }),
    );
  }

  /** 최악 N거래 */
  private getWorstTrades(trades: SimulatedTrade[], n: number): WorstTrade[] {
    return [...trades]
      .sort((a, b) => (a.netPnl ?? 0) - (b.netPnl ?? 0))
      .slice(0, n)
      .map((t) => ({
        rcpNo: t.rcpNo,
        corpCode: t.corpCode,
        stockCode: t.stockCode,
        netPnl: t.netPnl ?? 0,
        returnPct: t.returnPct ?? 0,
        entryDate: this.calendar.formatDate(t.entryDate),
        exitDate: t.exitDate ? this.calendar.formatDate(t.exitDate) : undefined,
        exitReason: t.exitReason,
      }));
  }

  /** 실전 투입 기준 6개 판정 */
  private checkRealWorldGate(
    trades: SimulatedTrade[],
    mdd: number,
    totalReturn: number,
    monthlyReturns: Record<string, number>,
    startDate: string,
    endDate: string,
  ): RealWorldGate {
    const months = Object.keys(monthlyReturns).sort();
    const upMonths = months.filter((m) => (monthlyReturns[m] ?? 0) > 0).length;
    const downMonths = months.filter((m) => (monthlyReturns[m] ?? 0) < 0).length;
    const flatMonths = months.filter((m) => (monthlyReturns[m] ?? 0) === 0).length;

    const allMarketConditions = upMonths > 0 && downMonths > 0 && (flatMonths > 0 || months.length >= 6);
    const netPositiveAfterCost = totalReturn > 0;

    // 단일종목 의존 여부: 최다 종목이 전체의 30% 초과하면 편향
    const corpCounts: Record<string, number> = {};
    for (const t of trades) {
      corpCounts[t.corpCode] = (corpCounts[t.corpCode] ?? 0) + 1;
    }
    const maxSingle = Math.max(0, ...Object.values(corpCounts));
    const diversified = trades.length === 0 || maxSingle / trades.length <= 0.3;

    // 이벤트별 최소 표본 10건
    const eventCounts: Record<string, number> = {};
    for (const t of trades) {
      eventCounts[t.eventType] = (eventCounts[t.eventType] ?? 0) + 1;
    }
    const sufficientSamples =
      Object.keys(eventCounts).length > 0 &&
      Object.values(eventCounts).every((c) => c >= 10);

    const mddAcceptable = mdd >= -15;

    // 최근 1/3 구간 수익 > 0
    const recentMonths = months.slice(Math.floor(months.length * 2 / 3));
    const recentReturn = recentMonths.reduce((s, m) => s + (monthlyReturns[m] ?? 0), 0);
    const recentPeriodConsistent = recentMonths.length === 0 || recentReturn > 0;

    return {
      allMarketConditions,
      netPositiveAfterCost,
      diversified,
      sufficientSamples,
      mddAcceptable,
      recentPeriodConsistent,
    };
  }
}
