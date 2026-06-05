export interface DisclosureTypeInfo {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
}

export const DISCLOSURE_TYPES: DisclosureTypeInfo[] = [
  { id: 'REGULAR', label: '정기공시', description: '사업/반기/분기보고서', sortOrder: 1 },
  { id: 'MATERIAL', label: '주요사항보고', description: '합병, 분할, 주요 경영 변동', sortOrder: 2 },
  { id: 'ISSUANCE', label: '발행공시', description: '증권신고서, 투자설명서', sortOrder: 3 },
  { id: 'EQUITY', label: '지분공시', description: '대량보유, 공개매수, 지분변동', sortOrder: 4 },
  { id: 'AUDIT', label: '감사공시', description: '감사보고서, 외부감사', sortOrder: 5 },
  { id: 'EXCHANGE', label: '거래소공시', description: '거래소 관련 공시, 시장조치', sortOrder: 6 },
  { id: 'OTHER', label: '기타공시', description: '기타 공시사항', sortOrder: 7 },
];

/** 공시 유형 ID 목록 */
export const DISCLOSURE_TYPE_IDS = DISCLOSURE_TYPES.map((t) => t.id);

// ====================================
// 투자 이벤트 1차 게이트 (M0 신규)
// ====================================

/**
 * 투자 관련 5종 이벤트 1차 게이트 정규식 패턴 목록
 *
 * M2 정밀 분류 전 보고서명만으로 빠르게 투자이벤트 여부를 선별한다.
 * PRIORITY_EVENT 명칭으로도 참조 가능하도록 동일 배열을 export한다.
 */
export const INVESTMENT_EVENT_PATTERNS: RegExp[] = [
  // 단일판매·공급계약
  /단일판매[·\s]*공급계약|공급계약\s*체결|판매계약\s*체결/,
  // 자기주식 취득·처분·소각
  /자기주식\s*(취득|처분|소각)|자사주\s*(취득|소각)/,
  // 현금·현물배당 결정
  /현금배당|현물배당|배당\s*결정|배당금\s*지급/,
  // 유상증자
  /유상증자|주주배정|제3자\s*배정|일반공모\s*증자/,
  // 전환사채·신주인수권부사채·교환사채
  /전환사채|신주인수권부사채|교환사채|CB[\s(]|BW[\s(]/,
];

/** PRIORITY_EVENT 패턴 — INVESTMENT_EVENT_PATTERNS 와 동일 (별칭) */
export const PRIORITY_EVENT_PATTERNS: RegExp[] = INVESTMENT_EVENT_PATTERNS;

/**
 * 투자 관련 5종 이벤트 1차 게이트 — 보고서명만으로 스크리닝
 *
 * 반환값이 true인 공시만 M2 이후 수치 추출 대상이 된다.
 * false 공시는 수집·저장은 하되 투자 이벤트 파이프라인으로 진입하지 않는다.
 *
 * @param reportName - DART 보고서명 (Disclosure.reportName)
 * @returns 5종 투자 이벤트 해당 여부
 */
export function isInvestmentRelevant(reportName: string): boolean {
  return INVESTMENT_EVENT_PATTERNS.some((pattern) => pattern.test(reportName));
}

/**
 * 보고서명으로 투자이벤트 타입을 1차 분류 (M2 정밀 분류 전 선별용)
 * 여러 패턴에 해당하면 첫 번째 매칭 이벤트 타입 반환
 */
export type InvestmentEventType =
  | 'SUPPLY_CONTRACT'
  | 'SHARE_BUYBACK'
  | 'SHARE_CANCELLATION'
  | 'DIVIDEND'
  | 'PAID_IN_CAPITAL_INCREASE'
  | 'CB_BW_ISSUANCE'
  | null;

/**
 * 보고서명으로 투자 이벤트 타입을 분류한다.
 * isInvestmentRelevant가 true인 공시에 대해 세부 타입을 반환하며,
 * 투자이벤트가 아닌 경우 null을 반환한다.
 */
export function classifyInvestmentEventType(reportName: string): InvestmentEventType {
  if (/단일판매[·\s]*공급계약|공급계약\s*체결|판매계약\s*체결/.test(reportName)) {
    return 'SUPPLY_CONTRACT';
  }
  if (/자기주식\s*소각|자사주\s*소각/.test(reportName)) {
    return 'SHARE_CANCELLATION';
  }
  if (/자기주식\s*(취득|처분)|자사주\s*취득/.test(reportName)) {
    return 'SHARE_BUYBACK';
  }
  if (/현금배당|현물배당|배당\s*결정|배당금\s*지급/.test(reportName)) {
    return 'DIVIDEND';
  }
  if (/유상증자|주주배정|제3자\s*배정|일반공모\s*증자/.test(reportName)) {
    return 'PAID_IN_CAPITAL_INCREASE';
  }
  if (/전환사채|신주인수권부사채|교환사채|CB[\s(]|BW[\s(]/.test(reportName)) {
    return 'CB_BW_ISSUANCE';
  }
  return null;
}
