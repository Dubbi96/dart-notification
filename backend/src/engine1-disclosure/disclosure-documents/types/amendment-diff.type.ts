// backend/src/disclosure-documents/types/amendment-diff.type.ts

export type ChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED';

/**
 * 단일 필드 변경 정보
 */
export interface FieldDiff {
  /** 변경된 필드명 */
  field: string;
  /** 원공시 값 (null이면 원공시에 해당 필드 없음) */
  before: unknown;
  /** 정정공시 값 */
  after: unknown;
  changeType: ChangeType;
  /** 숫자 필드만: (after - before) / |before| (소수점 4자리). before = 0이면 미포함 */
  changePct?: number;
}

/**
 * 원공시↔정정공시 전체 diff 결과
 */
export interface AmendmentDiff {
  originalRcpNo: string;
  amendmentRcpNo: string;
  changedFields: FieldDiff[];
  /** 예: "계약금액 1,000억 → 1,200억 (+20.0%)" */
  summary: string;
}
