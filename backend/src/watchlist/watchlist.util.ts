/**
 * DAR-165 — 워치리스트 신규 공시(unread) 카운트 순수 로직.
 *
 * Disclosure.rcpDt 는 KST 기준 'YYYYMMDD' 또는 'YYYYMMDDHHmmss' 문자열이다.
 * 사용자의 마지막 조회 시각(lastViewedAt, UTC DateTime)을 동일 포맷의 KST 임계값
 * 문자열로 변환하면, 사전식(lexicographic) 비교가 곧 시간순 비교가 된다
 * (제로패딩 고정폭 + 8자리 rcpDt 는 해당 일자의 00:00:00 으로 해석).
 * 8자리/14자리가 섞여 있어도 자릿수 비교가 일관되므로 결정론적이다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 기준 시각(UTC Date)을 KST 기준 'YYYYMMDDHHmmss' 임계 문자열로 변환한다.
 * 반환값보다 rcpDt 가 사전식으로 크면(> ) 신규 공시로 판정한다.
 */
export function formatRcpThreshold(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}${hh}${mm}${ss}`;
}

/**
 * 단일 공시 rcpDt 가 임계값 이후(신규)인지 판정한다.
 * Postgres varchar `>` 비교와 동일한 사전식 비교(ASCII 숫자)를 사용하므로
 * DB count 쿼리(`rcpDt: { gt: threshold }`)와 결과가 일치한다.
 */
export function isNewDisclosure(rcpDt: string, threshold: string): boolean {
  return rcpDt > threshold;
}

/**
 * rcpDt 목록 중 임계값 이후 신규 공시 수를 센다(인메모리 검증용 순수 함수).
 */
export function countNewDisclosures(rcpDts: string[], threshold: string): number {
  return rcpDts.reduce((acc, rcpDt) => acc + (isNewDisclosure(rcpDt, threshold) ? 1 : 0), 0);
}
