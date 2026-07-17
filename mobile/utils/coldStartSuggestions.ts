// 콜드스타트 온보딩 추천 종목 도출 — DAR-537.
// 관심기업 0 사용자를 위한 첫 등록 후보를 "인기 종목(서버 집계 /companies/popular)"과
// "최근 공시 활발 종목(홈에 이미 로드된 전체 피드에서 도출 — 추가 요청 없음)" 두 풀에서 만든다.
//
// 이 파일은 React Native 의존성이 없는 순수 로직만 둔다 — 화면(components/home/ColdStartOnboarding.tsx)·
// 결정론 검증(scripts/check-coldstart-onboarding.ts)·유닛 테스트가 함께 import 해 드리프트를 막는다.

/** 추천 선택 유도 구간(3~5개) — 카드 카피와 검증이 공유하는 SSOT. */
export const COLD_START_RECOMMEND_MIN = 3;
export const COLD_START_RECOMMEND_MAX = 5;

/** 인기 풀 상한 — 활발 풀이 밀려나지 않도록 인기 종목이 전체를 독식하지 않게 한다. */
export const COLD_START_POPULAR_CAP = 6;
/** 전체 추천 칩 상한 — 카드가 홈 헤더를 과점하지 않는 밀도 상한. */
export const COLD_START_TOTAL_CAP = 10;

export type ColdStartSource = 'popular' | 'active';

export interface ColdStartCompany {
  corpCode: string;
  corpName: string;
}

export interface ColdStartSuggestion extends ColdStartCompany {
  source: ColdStartSource;
}

/**
 * 최근 공시 활발 종목 — 피드 항목의 corpCode 빈도 상위(동률은 먼저 등장한 순 = 최신 공시 순).
 * 관심 0 상태의 홈 피드는 항상 '전체 공시'(hasWatchlist=false → feedTab='all')라 풀로 적합하다.
 */
export function deriveActiveCompanies(
  disclosures: ReadonlyArray<ColdStartCompany>,
  limit = 4,
): ColdStartCompany[] {
  const byCode = new Map<string, ColdStartCompany & { count: number; firstIndex: number }>();
  disclosures.forEach((d, index) => {
    if (!d.corpCode || !d.corpName) return;
    const entry = byCode.get(d.corpCode);
    if (entry) {
      entry.count += 1;
    } else {
      byCode.set(d.corpCode, { corpCode: d.corpCode, corpName: d.corpName, count: 1, firstIndex: index });
    }
  });
  return [...byCode.values()]
    .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)
    .slice(0, limit)
    .map(({ corpCode, corpName }) => ({ corpCode, corpName }));
}

/** 인기(상한 popularCap) → 활발 순으로 corpCode 중복 제거 병합(전체 totalCap). */
export function mergeSuggestions(
  popular: ReadonlyArray<ColdStartCompany>,
  active: ReadonlyArray<ColdStartCompany>,
  popularCap = COLD_START_POPULAR_CAP,
  totalCap = COLD_START_TOTAL_CAP,
): ColdStartSuggestion[] {
  const out: ColdStartSuggestion[] = [];
  const seen = new Set<string>();
  for (const c of popular.slice(0, popularCap)) {
    if (!c.corpCode || !c.corpName || seen.has(c.corpCode)) continue;
    seen.add(c.corpCode);
    out.push({ corpCode: c.corpCode, corpName: c.corpName, source: 'popular' });
    if (out.length >= totalCap) return out;
  }
  for (const c of active) {
    if (!c.corpCode || !c.corpName || seen.has(c.corpCode)) continue;
    seen.add(c.corpCode);
    out.push({ corpCode: c.corpCode, corpName: c.corpName, source: 'active' });
    if (out.length >= totalCap) break;
  }
  return out;
}
