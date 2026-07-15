/**
 * DAR-185 — 워치리스트 신규 공시(unread) 카운트: rcpNo 커서 기반 순수 로직.
 *
 * 기존(DAR-165)은 lastViewedAt(타임스탬프)을 14자리 KST 임계 문자열로 만들어
 * Disclosure.rcpDt 와 사전식 비교했다. 그러나 실데이터 rcpDt 는 DART rcept_dt
 * (날짜만, 8자리 'YYYYMMDD')라 14자리 임계값의 접두사가 되어 항상 작았다
 * (`'20260613' > '20260613090000'` === false). 결과적으로 "당일 들어온 공시"는
 * 자정 롤오버 전까지 절대 신규로 잡히지 않았다(DAR-185 버그).
 *
 * 해결: 일(day) 단위라 시각을 잃는 rcpDt 대신, 자연키 rcpNo(='YYYYMMDD'+6자리 일련번호,
 * 사전식으로 단조 증가)를 커서로 쓴다. 마지막으로 본 rcpNo 보다 큰 공시만 신규다.
 * 하루 안의 접수 순서까지 보존되므로 같은 날 이후에 들어온 공시도 정확히 집계되고,
 * 조회 직후(markViewed 가 커서를 최신 rcpNo 로 고정)에는 배지가 0 으로 떨어진다.
 */

import { UserTier } from '@prisma/client';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 갭분석 W1 — 엔티틀먼트 게이트: 관심기업 한도를 티어별로 정의한다.
 * 기존 MAX_WATCHLIST_COUNT=30 하드코딩을 User.tier 조회 기반으로 전환하는 소켓.
 * FREE=30(현행 유지), PRO=200. 결제·가격·티어 변경 API는 만들지 않는다 —
 * 티어 부여는 당분간 서버 config(수동)로만 이뤄진다.
 */
export const WATCHLIST_LIMIT_BY_TIER: Record<UserTier, number> = {
  [UserTier.FREE]: 30,
  [UserTier.PRO]: 200,
};

/**
 * 티어의 관심기업 한도를 반환한다. 사용자 행이 없거나 티어가 비어 있으면
 * 보수적으로 FREE 한도(30)로 폴백한다(과거 행·경합 삭제 대비).
 */
export function watchlistLimitForTier(tier: UserTier | null | undefined): number {
  return WATCHLIST_LIMIT_BY_TIER[tier ?? UserTier.FREE];
}

/**
 * 아직 한 번도 조회하지 않은(lastViewedRcpNo 부재) 항목의 기준 커서.
 * 기준 시각(보통 등록 시각 createdAt)의 KST 일자 0시 floor('YYYYMMDD' + '000000')를 반환한다.
 * 실 rcpNo 의 일련번호는 '000001' 이상이라, rcpNo > floor 이면 그 일자 당일 또는
 * 이후에 접수된 공시 = 신규로 본다(이전 일자는 floor 보다 작아 제외).
 */
export function rcpNoFloorFromDate(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}000000`;
}

/**
 * 워치리스트 항목의 신규 판정 커서를 고른다.
 * 조회 이력(lastViewedRcpNo)이 있으면 그 rcpNo, 없으면 등록 시각 기반 floor.
 */
export function resolveCursor(
  lastViewedRcpNo: string | null | undefined,
  createdAt: Date,
): string {
  return lastViewedRcpNo ?? rcpNoFloorFromDate(createdAt);
}

/**
 * 단일 공시 rcpNo 가 커서 이후(신규)인지 판정한다.
 * Postgres varchar `>` 비교와 동일한 사전식 비교(ASCII 숫자)를 사용하므로
 * DB count 쿼리(`rcpNo: { gt: cursor }`)와 결과가 일치한다.
 */
export function isNewByCursor(rcpNo: string, cursor: string): boolean {
  return rcpNo > cursor;
}

/**
 * rcpNo 목록 중 커서 이후 신규 공시 수를 센다(인메모리 검증용 순수 함수).
 */
export function countNewByCursor(rcpNos: string[], cursor: string): number {
  return rcpNos.reduce(
    (acc, rcpNo) => acc + (isNewByCursor(rcpNo, cursor) ? 1 : 0),
    0,
  );
}

/**
 * DAR-214 — grouped count 쿼리 결과(corpCode 별 신규 공시 수) 행 배열을 corpCode → count
 * Map 으로 정규화한다(순수 함수). LEFT JOIN 으로 0건 종목도 행이 남으나, 행이 누락된
 * corpCode 는 호출부에서 `?? 0` 으로 폴백한다. COUNT 가 bigint 로 와도 number 로 강제
 * 변환해 안전하게 매핑한다.
 */
export function newCountMapFromGrouped(
  grouped: { corpCode: string; count: number | bigint }[],
): Map<string, number> {
  return new Map(grouped.map((g) => [g.corpCode, Number(g.count)]));
}
