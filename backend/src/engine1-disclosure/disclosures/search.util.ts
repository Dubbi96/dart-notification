/**
 * 공시 SEO식(스마트) 검색 유틸 — 순수 함수 모음 (DAR-45).
 *
 * 단일 LIKE → 다중필드 + 토큰 분해(공백 단위 AND) + 관련도 정렬을 위한
 * Prisma 의존 없는 순수 로직. 서비스에서 조합해 사용하며 단위테스트 대상이다.
 */

/** 관련도 정렬 시 메모리에서 재정렬할 최대 스캔 건수 (무마이그레이션 트레이드오프). */
export const RELEVANCE_SCAN_LIMIT = 200;

/**
 * 검색어를 공백 단위 토큰으로 분해한다.
 * - 소문자 정규화, 중복 제거, 빈 토큰 제거
 * - 예: "삼성  유상증자" → ["삼성", "유상증자"]
 */
export function tokenize(q: string | undefined): string[] {
  return Array.from(
    new Set(
      (q ?? '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    ),
  );
}

/**
 * 기간 필터를 rcpDt(문자열 YYYYMMDD 또는 YYYYMMDDHHmmss) 비교용 범위로 변환한다.
 * - to는 8자리(일 단위)면 그날 끝까지 포함하도록 '999999'를 덧붙여 사전식 비교를 보정한다.
 *   (예: to="20241231" → "20241231999999" ≥ 어떤 "20241231HHmmss")
 */
export function normalizePeriod(
  from?: string,
  to?: string,
): { gte?: string; lte?: string } | undefined {
  const range: { gte?: string; lte?: string } = {};
  if (from) range.gte = from;
  if (to) range.lte = to.length === 8 ? `${to}999999` : to;
  return Object.keys(range).length > 0 ? range : undefined;
}

/** 관련도 점수 계산 대상 (스칼라 필드 + Company.stockCode). */
export interface ScorableDisclosure {
  reportName: string;
  corpName: string;
  flrName: string;
  stockCode?: string | null;
  rcpDt: string;
}

/**
 * 관련도 점수 — 높을수록 우선. 동점은 호출부에서 최신순(rcpDt desc)으로 처리.
 * 가중치: 기업명 정확/접두 일치 > 종목코드 정확 > 기업명 부분 > 종목코드 부분 > 보고서명 > 제출인명.
 */
export function scoreDisclosure(
  d: ScorableDisclosure,
  tokens: string[],
  normalizedQuery: string,
): number {
  const corp = d.corpName.toLowerCase();
  const report = d.reportName.toLowerCase();
  const flr = d.flrName.toLowerCase();
  const code = (d.stockCode ?? '').toLowerCase();

  let score = 0;
  if (normalizedQuery) {
    if (corp === normalizedQuery) score += 100;
    else if (corp.startsWith(normalizedQuery)) score += 50;
  }
  for (const t of tokens) {
    if (code && code === t) score += 40;
    if (corp.includes(t)) score += 12;
    if (code && code.includes(t)) score += 8;
    if (report.includes(t)) score += 5;
    if (flr.includes(t)) score += 2;
  }
  return score;
}

/** 최신순 비교자 (rcpDt desc, 동률 rcpNo desc). */
export function compareRecency(
  a: { rcpDt: string; rcpNo: string },
  b: { rcpDt: string; rcpNo: string },
): number {
  if (a.rcpDt !== b.rcpDt) return a.rcpDt < b.rcpDt ? 1 : -1;
  if (a.rcpNo !== b.rcpNo) return a.rcpNo < b.rcpNo ? 1 : -1;
  return 0;
}
