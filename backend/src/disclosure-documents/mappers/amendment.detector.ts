// backend/src/disclosure-documents/mappers/amendment.detector.ts
// Disclosure.rmk 필드 분석 → 정정공시 여부·원공시 rcpNo 추출

// ─── 패턴 상수 ───────────────────────────────────────────────────────────────

/** rmk 필드 정정공시 판정 패턴 (규칙 A-01) */
const AMENDMENT_PATTERNS: RegExp[] = [
  /\[기재정정\]/,
  /\[첨부정정\]/,
  /\[자진정정\]/,
  /\[정정\]/,
  /정정\s*신고/,
  /정정\s*보고/,
];

/** reportName 보조 판정 패턴 (규칙 A-02) */
const AMENDMENT_REPORT_PATTERNS: RegExp[] = [
  /\[기재정정\]/,
  /\[첨부정정\]/,
  /\(정정\)/,
  /정정\s*신고서/,
];

// ─── 퍼블릭 함수 ─────────────────────────────────────────────────────────────

/**
 * Disclosure.rmk 필드를 분석해 정정공시 여부를 반환한다 (규칙 A-01)
 *
 * @param rmk - Disclosure.rmk 필드 값
 * @returns true이면 정정공시
 */
export function isAmendment(rmk: string): boolean {
  if (!rmk) return false;
  return AMENDMENT_PATTERNS.some((p) => p.test(rmk));
}

/**
 * reportName으로 정정공시 여부를 보조 판정한다 (규칙 A-02)
 * rmk가 비어있거나 null인 경우 사용하는 fallback
 */
export function isAmendmentByReportName(reportName: string): boolean {
  if (!reportName) return false;
  return AMENDMENT_REPORT_PATTERNS.some((p) => p.test(reportName));
}

/**
 * 최종 정정공시 판정: rmk 또는 reportName 중 하나라도 해당하면 true
 */
export function detectAmendment(rmk: string, reportName: string): boolean {
  return isAmendment(rmk) || isAmendmentByReportName(reportName);
}

/**
 * rmk 내에서 원공시 rcpNo(정확히 14자리 숫자)를 추출한다 (규칙 A-03)
 *
 * DART rcpNo는 항상 14자리 숫자 (예: 20240101123456)
 * 여러 개일 경우 첫 번째 14자리 숫자 사용
 * 추출 실패 시 null 반환
 *
 * (?<!\d): 앞에 숫자 없음, (?!\d): 뒤에 숫자 없음 → 정확히 14자리만 매칭
 */
export function extractOriginalRcpNo(rmk: string): string | null {
  if (!rmk) return null;
  // 앞뒤가 숫자가 아닌 정확히 14자리 숫자 추출 (lookbehind/lookahead)
  const match = rmk.match(/(?<!\d)(\d{14})(?!\d)/);
  return match ? match[1] : null;
}
