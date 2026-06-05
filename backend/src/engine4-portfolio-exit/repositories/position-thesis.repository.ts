/**
 * IPositionThesisRepository — Position Thesis 리포지토리 인터페이스 (M7, DAR-11)
 *
 * 구현체:
 *   - 인메모리 어댑터 (in-memory-position-thesis.repository.ts) — 테스트·폴백용
 *   - Prisma 어댑터 (prisma-position-thesis.repository.ts) — 영속화 (M8, DAR-34)
 *
 * DI 바인딩은 POSITION_THESIS_REPOSITORY 토큰을 통해 주입한다
 * (portfolio-exit.module.ts에서 useClass로 구현체 교체).
 */

import { PositionThesisRecord, ThesisStatus } from '../domain/position-thesis.types';

/** IPositionThesisRepository DI 주입 토큰 */
export const POSITION_THESIS_REPOSITORY = 'IPositionThesisRepository';

export interface IPositionThesisRepository {
  save(thesis: PositionThesisRecord): Promise<PositionThesisRecord>;
  findById(id: string): Promise<PositionThesisRecord | null>;
  findBySignalId(tradingSignalId: string): Promise<PositionThesisRecord | null>;
  findByCorpCode(corpCode: string): Promise<PositionThesisRecord[]>;
  findByStatus(status: ThesisStatus): Promise<PositionThesisRecord[]>;
  updateStatus(id: string, status: ThesisStatus): Promise<PositionThesisRecord>;
  findAll(): Promise<PositionThesisRecord[]>;
}
