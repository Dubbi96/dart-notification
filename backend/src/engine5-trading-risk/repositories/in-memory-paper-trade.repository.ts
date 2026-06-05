// InMemoryPaperTradeRepository — 테스트/fixture용 (M10-A, DAR-16)

import { Injectable } from '@nestjs/common';
import { IPaperTradeRepository, PaperTradeRecord } from './paper-trade.repository';
import { TradeStatus } from '../domain/paper-trade.types';

@Injectable()
export class InMemoryPaperTradeRepository implements IPaperTradeRepository {
  private records: Map<string, PaperTradeRecord> = new Map();
  private counter = 0;

  async save(record: Omit<PaperTradeRecord, 'id' | 'createdAt'>): Promise<PaperTradeRecord> {
    const id = `paper-trade-${++this.counter}`;
    const full: PaperTradeRecord = { ...record, id, createdAt: new Date() };
    this.records.set(id, full);
    return full;
  }

  async findById(id: string): Promise<PaperTradeRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByStatus(status: TradeStatus): Promise<PaperTradeRecord[]> {
    return [...this.records.values()].filter(r => r.status === status);
  }

  async findAll(): Promise<PaperTradeRecord[]> {
    return [...this.records.values()];
  }
}
