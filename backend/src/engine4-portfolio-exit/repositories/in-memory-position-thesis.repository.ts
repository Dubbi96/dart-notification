/**
 * InMemoryPositionThesisRepository — 인메모리 리포지토리 어댑터 (M7, DAR-11)
 *
 * 실제 DB 없이 단위 테스트·fixture 검증용. M8에서 Prisma 어댑터로 교체.
 */

import { Injectable } from '@nestjs/common';
import { PositionThesisRecord, ThesisStatus } from '../domain/position-thesis.types';
import { IPositionThesisRepository } from './position-thesis.repository';

@Injectable()
export class InMemoryPositionThesisRepository
  implements IPositionThesisRepository
{
  private readonly store = new Map<string, PositionThesisRecord>();

  async save(thesis: PositionThesisRecord): Promise<PositionThesisRecord> {
    this.store.set(thesis.id, { ...thesis });
    return thesis;
  }

  async findById(id: string): Promise<PositionThesisRecord | null> {
    return this.store.get(id) ?? null;
  }

  async findBySignalId(tradingSignalId: string): Promise<PositionThesisRecord | null> {
    for (const thesis of this.store.values()) {
      if (thesis.tradingSignalId === tradingSignalId) return thesis;
    }
    return null;
  }

  async findByCorpCode(corpCode: string): Promise<PositionThesisRecord[]> {
    return [...this.store.values()].filter((t) => t.corpCode === corpCode);
  }

  async findByStatus(status: ThesisStatus): Promise<PositionThesisRecord[]> {
    return [...this.store.values()].filter((t) => t.status === status);
  }

  async updateStatus(id: string, status: ThesisStatus): Promise<PositionThesisRecord> {
    const thesis = this.store.get(id);
    if (!thesis) throw new Error(`PositionThesis ${id} not found`);
    const updated = { ...thesis, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async findAll(): Promise<PositionThesisRecord[]> {
    return [...this.store.values()];
  }

  clear(): void {
    this.store.clear();
  }
}
