/**
 * Position Thesis 도메인 타입 — M7 (DAR-11)
 *
 * AI 금지영역: PositionThesis 생성·평가는 순수 Rule 기반.
 * maxWeight·exitRules는 AI 변경 불가. Engine5 Risk가 최종 강제.
 */

import { InvalidCondition, ExitRule } from './invalid-condition.types';

// ─── 생명주기 상태 ─────────────────────────────────────────────────

export type ThesisStatus = 'ACTIVE' | 'INVALIDATED' | 'CLOSED';

// ACTIVE → INVALIDATED → CLOSED (단방향 FSM)
export const THESIS_TRANSITIONS: Record<ThesisStatus, ThesisStatus[]> = {
  ACTIVE: ['INVALIDATED', 'CLOSED'],
  INVALIDATED: ['CLOSED'],
  CLOSED: [],
};

// ─── PositionThesis 도메인 레코드 ──────────────────────────────────

export interface PositionThesisRecord {
  id: string;
  tradingSignalId: string;
  rcpNo: string;
  corpCode: string;
  entryReason: string;
  initialThesis: string[];         // 근거 항목 배열
  invalidConditions: InvalidCondition[]; // 기계 평가 가능 구조화 조건
  exitRules: ExitRule[];           // 청산룰, AI 변경 불가
  maxWeight: number;               // 최대 비중 (%), 하드룰
  status: ThesisStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─── 생성 파라미터 ─────────────────────────────────────────────────

export interface CreatePositionThesisParams {
  tradingSignalId: string;
  rcpNo: string;
  corpCode: string;
  entryReason: string;
  initialThesis: string[];
  invalidConditions: InvalidCondition[];
  exitRules?: ExitRule[];
  maxWeight?: number;
}

// ─── 기본값 (Rule 기반 하드코딩) ────────────────────────────────────

export const DEFAULT_EXIT_RULES: ExitRule[] = [
  { type: 'STOP_LOSS_PCT', value: 8 },
  { type: 'MAX_HOLD_DAYS', value: 20 },
  { type: 'INVALIDATION_TRIGGER' },
];

export const DEFAULT_MAX_WEIGHT = 5.0; // % (단일 종목 기본 5%, 상한 10%)
export const MAX_WEIGHT_HARD_LIMIT = 10.0; // % — AI 우회 불가

// ─── 생명주기 유틸 ─────────────────────────────────────────────────

export function canTransition(
  from: ThesisStatus,
  to: ThesisStatus,
): boolean {
  return THESIS_TRANSITIONS[from].includes(to);
}
