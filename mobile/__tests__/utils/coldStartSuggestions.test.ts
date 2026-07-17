import {
  COLD_START_POPULAR_CAP,
  COLD_START_TOTAL_CAP,
  deriveActiveCompanies,
  mergeSuggestions,
} from '@utils/coldStartSuggestions';

// 콜드스타트 추천 도출 순수 로직(DAR-537) — 화면(ColdStartOnboarding)과 홈이 공유하는 SSOT.
describe('utils/coldStartSuggestions', () => {
  describe('deriveActiveCompanies', () => {
    it('corpCode 빈도 상위 순으로 뽑고, 동률은 먼저 등장한(최신 공시) 순을 유지한다', () => {
      const feed = [
        { corpCode: 'A', corpName: '에이' },
        { corpCode: 'B', corpName: '비' },
        { corpCode: 'B', corpName: '비' },
        { corpCode: 'C', corpName: '씨' },
        { corpCode: 'B', corpName: '비' },
        { corpCode: 'C', corpName: '씨' },
      ];
      expect(deriveActiveCompanies(feed, 3)).toEqual([
        { corpCode: 'B', corpName: '비' }, // 3회
        { corpCode: 'C', corpName: '씨' }, // 2회
        { corpCode: 'A', corpName: '에이' }, // 1회 — 최초 등장 순
      ]);
    });

    it('corpCode/corpName 이 빈 항목은 제외하고, limit 으로 자른다', () => {
      const feed = [
        { corpCode: '', corpName: '무명' },
        { corpCode: 'A', corpName: '에이' },
        { corpCode: 'B', corpName: '비' },
      ];
      expect(deriveActiveCompanies(feed, 1)).toEqual([{ corpCode: 'A', corpName: '에이' }]);
    });

    it('빈 피드면 빈 배열을 반환한다(카드는 검색 폴백으로 처리)', () => {
      expect(deriveActiveCompanies([])).toEqual([]);
    });
  });

  describe('mergeSuggestions', () => {
    it('인기(popular) → 활발(active) 순으로 합치고 corpCode 중복은 인기 쪽만 남긴다', () => {
      const popular = [
        { corpCode: 'A', corpName: '에이' },
        { corpCode: 'B', corpName: '비' },
      ];
      const active = [
        { corpCode: 'B', corpName: '비' }, // 중복 — 제외
        { corpCode: 'C', corpName: '씨' },
      ];
      expect(mergeSuggestions(popular, active)).toEqual([
        { corpCode: 'A', corpName: '에이', source: 'popular' },
        { corpCode: 'B', corpName: '비', source: 'popular' },
        { corpCode: 'C', corpName: '씨', source: 'active' },
      ]);
    });

    it('인기 풀은 popularCap 까지만 쓰고 활발 풀 자리를 보장한다', () => {
      const popular = Array.from({ length: COLD_START_POPULAR_CAP + 3 }, (_, i) => ({
        corpCode: `P${i}`,
        corpName: `인기${i}`,
      }));
      const active = [{ corpCode: 'ACT', corpName: '활발' }];
      const merged = mergeSuggestions(popular, active);
      expect(merged.filter((s) => s.source === 'popular')).toHaveLength(COLD_START_POPULAR_CAP);
      expect(merged.some((s) => s.corpCode === 'ACT' && s.source === 'active')).toBe(true);
    });

    it('전체 totalCap 을 넘지 않는다', () => {
      const popular = Array.from({ length: 20 }, (_, i) => ({
        corpCode: `P${i}`,
        corpName: `인기${i}`,
      }));
      const active = Array.from({ length: 20 }, (_, i) => ({
        corpCode: `A${i}`,
        corpName: `활발${i}`,
      }));
      expect(mergeSuggestions(popular, active).length).toBeLessThanOrEqual(COLD_START_TOTAL_CAP);
    });
  });
});
