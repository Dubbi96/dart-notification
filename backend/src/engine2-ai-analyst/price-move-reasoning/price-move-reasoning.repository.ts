import { AiCostLevel } from '../types/ai-analyst.types';
import { PriceMoveReasoningStatus } from './price-move-reasoning.constants';

/**
 * 역방향 리즈닝 결과 캐시 레코드 — 등락 이벤트(refId)당 1행(멱등).
 * rcpNo(causal 공시)를 함께 보존 → rcpNo × 등락 이벤트 멱등.
 */
export interface PriceMoveReasoningRecord {
  refId: string;
  stockCode: string;
  corpCode: string;
  tradeDate: string;
  changePct: number;
  rcpNo: string | null;
  status: PriceMoveReasoningStatus;
  level: AiCostLevel | null;
  resultJson: unknown;
  createdAt: Date;
}

/**
 * 역방향 리즈닝 영속 포트 — DisclosureAnalysis(rcpNo+task)와 별개.
 * refId(등락 이벤트)를 자연키로 upsert 하여 중복 AI 호출·재처리에 안전하다.
 */
export abstract class PriceMoveReasoningRepository {
  /** 등락 이벤트(refId) 기존 리즈닝 조회 — 있으면 멱등 캐시 히트(AI 재호출 없음). */
  abstract find(refId: string): Promise<PriceMoveReasoningRecord | null>;

  /** 리즈닝 결과 저장(refId upsert — 멱등). */
  abstract save(record: PriceMoveReasoningRecord): Promise<void>;
}
