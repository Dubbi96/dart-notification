/**
 * IPositionThesisRepository — Position Thesis 리포지토리 인터페이스 (M7, DAR-11)
 *
 * 구현체: 인메모리 어댑터 (in-memory-position-thesis.repository.ts)
 * 후속 M8에서 PrismaPositionThesisRepository로 교체 예정.
 */

import { PositionThesisRecord, ThesisStatus } from '../domain/position-thesis.types';

export interface IPositionThesisRepository {
  save(thesis: PositionThesisRecord): Promise<PositionThesisRecord>;
  findById(id: string): Promise<PositionThesisRecord | null>;
  findBySignalId(tradingSignalId: string): Promise<PositionThesisRecord | null>;
  findByCorpCode(corpCode: string): Promise<PositionThesisRecord[]>;
  findByStatus(status: ThesisStatus): Promise<PositionThesisRecord[]>;
  updateStatus(id: string, status: ThesisStatus): Promise<PositionThesisRecord>;
  findAll(): Promise<PositionThesisRecord[]>;
}
