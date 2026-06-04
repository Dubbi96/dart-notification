// 가상 포트폴리오 추적기 — 순수 Rule (M10-A, DAR-16)
// AI 금지영역: 포트폴리오 비중·손익 계산은 순수 Rule. AI 개입 0.

import { PaperHolding, PaperPortfolioState } from './paper-trade.types';

export interface TradeRecord {
  corpCode: string;
  stockCode: string;
  direction: 'BUY' | 'SELL';
  filledShares: number;
  filledPrice: number;
  commission: number;
  tax: number;
  slippageCost: number;
}

export interface PriceMap {
  [stockCode: string]: number;
}

export class PaperPortfolio {
  private cash: number;
  private holdingsMap: Map<string, { corpCode: string; shares: number; avgEntryPrice: number }>;
  private realizedPnl: number;

  constructor(initialCash: number) {
    this.cash = initialCash;
    this.holdingsMap = new Map();
    this.realizedPnl = 0;
  }

  applyTrade(trade: TradeRecord): void {
    const totalCost = trade.commission + trade.tax + trade.slippageCost;
    const tradeValue = trade.filledPrice * trade.filledShares;

    if (trade.direction === 'BUY') {
      this.cash -= tradeValue + totalCost;

      const existing = this.holdingsMap.get(trade.stockCode);
      if (existing) {
        // 가중평균 진입가 갱신
        const totalShares = existing.shares + trade.filledShares;
        const totalValue = existing.avgEntryPrice * existing.shares + trade.filledPrice * trade.filledShares;
        existing.avgEntryPrice = totalValue / totalShares;
        existing.shares = totalShares;
      } else {
        this.holdingsMap.set(trade.stockCode, {
          corpCode: trade.corpCode,
          shares: trade.filledShares,
          avgEntryPrice: trade.filledPrice,
        });
      }
    } else {
      // SELL
      const existing = this.holdingsMap.get(trade.stockCode);
      if (!existing) return;

      const exitValue = trade.filledPrice * trade.filledShares;
      const entryCost = existing.avgEntryPrice * trade.filledShares;
      this.realizedPnl += exitValue - entryCost - totalCost;
      this.cash += exitValue - totalCost;

      existing.shares -= trade.filledShares;
      if (existing.shares <= 0) {
        this.holdingsMap.delete(trade.stockCode);
      }
    }
  }

  getState(priceMap: PriceMap): PaperPortfolioState {
    const holdings: PaperHolding[] = [];
    let totalMarketValue = 0;

    for (const [stockCode, h] of this.holdingsMap.entries()) {
      const currentPrice = priceMap[stockCode] ?? h.avgEntryPrice;
      const marketValue = currentPrice * h.shares;
      const unrealizedPnl = marketValue - h.avgEntryPrice * h.shares;
      const unrealizedPnlPct = unrealizedPnl / (h.avgEntryPrice * h.shares);
      totalMarketValue += marketValue;
      holdings.push({
        corpCode: h.corpCode,
        stockCode,
        shares: h.shares,
        avgEntryPrice: h.avgEntryPrice,
        currentPrice,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
        weight: 0, // 아래에서 재계산
      });
    }

    const totalValue = this.cash + totalMarketValue;
    let totalUnrealizedPnl = 0;

    for (const h of holdings) {
      h.weight = totalValue > 0 ? h.marketValue / totalValue : 0;
      totalUnrealizedPnl += h.unrealizedPnl;
    }

    return {
      cash: this.cash,
      totalMarketValue,
      totalValue,
      totalUnrealizedPnl,
      totalRealizedPnl: this.realizedPnl,
      holdings,
    };
  }
}
