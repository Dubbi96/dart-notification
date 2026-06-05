// IPaperTradeRepository 인터페이스 (M10-A, DAR-16)

import { TradeStatus } from '../domain/paper-trade.types';

export interface PaperTradeRecord {
  id: string;
  corpCode: string;
  stockCode: string;
  direction: 'BUY' | 'SELL';
  orderedShares: number;
  filledShares: number;
  fillRate: number;
  entryPrice: number;
  filledPrice: number | null;
  commission: number;
  tax: number;
  slippageCost: number;
  grossPnl: number | null;
  netPnl: number | null;
  returnPct: number | null;
  status: TradeStatus;
  entryDate: Date;
  filledAt: Date | null;
  tradingSignalId: string | null;
  positionThesisId: string | null;
  createdAt: Date;
}

export interface IPaperTradeRepository {
  save(record: Omit<PaperTradeRecord, 'id' | 'createdAt'>): Promise<PaperTradeRecord>;
  findById(id: string): Promise<PaperTradeRecord | null>;
  findByStatus(status: TradeStatus): Promise<PaperTradeRecord[]>;
  findAll(): Promise<PaperTradeRecord[]>;
}
