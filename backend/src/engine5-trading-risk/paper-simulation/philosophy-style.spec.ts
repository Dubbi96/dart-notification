/**
 * philosophy-style.spec.ts — 철학 스타일 분기 순수 Rule 검증 (DAR-76, P-D)
 * 진입 적격성(적합도 필터)·비교 랭킹·식별 헬퍼의 결정론적 동작을 고정한다.
 */
import {
  PHILOSOPHY_STYLES,
  STYLE_ENTRY_MIN_FIT,
  STYLE_LOW_SAMPLE_THRESHOLD,
  stylePortfolioName,
  parsePhilosophyStyle,
  eligibleStylesForCompany,
  isStyleEligible,
  rankStyles,
  PhilosophyFitLike,
  StyleReturnRow,
} from './philosophy-style';

describe('philosophy-style (DAR-76)', () => {
  describe('식별 헬퍼', () => {
    it('4개 거장 스타일을 고정한다', () => {
      expect([...PHILOSOPHY_STYLES]).toEqual([
        'BUFFETT',
        'LYNCH',
        'GREENBLATT',
        'DRUCKENMILLER',
      ]);
    });

    it('stylePortfolioName 은 접두사+태그 형식', () => {
      expect(stylePortfolioName('BUFFETT')).toBe('모의운용 포트폴리오 [BUFFETT]');
    });

    it('parsePhilosophyStyle 은 유효값만 통과·그 외 null', () => {
      expect(parsePhilosophyStyle('LYNCH')).toBe('LYNCH');
      expect(parsePhilosophyStyle('lynch')).toBeNull();
      expect(parsePhilosophyStyle('UNKNOWN')).toBeNull();
    });
  });

  describe('eligibleStylesForCompany (적합도 진입 필터)', () => {
    const fits: PhilosophyFitLike[] = [
      { philosophyId: 'BUFFETT', computable: true, score: 80 },
      { philosophyId: 'LYNCH', computable: true, score: 40 }, // 임계 미만
      { philosophyId: 'GREENBLATT', computable: false, score: null }, // 재무 결측
      { philosophyId: 'DRUCKENMILLER', computable: true, score: STYLE_ENTRY_MIN_FIT }, // 경계=통과
    ];

    it('score ≥ 임계 & computable 인 스타일만 적격', () => {
      expect(eligibleStylesForCompany(fits)).toEqual(['BUFFETT', 'DRUCKENMILLER']);
    });

    it('computable=false(재무 결측)는 거짓 진입을 막는다', () => {
      expect(eligibleStylesForCompany(fits)).not.toContain('GREENBLATT');
    });

    it('커스텀 minFit 으로 더 엄격하게 거를 수 있다', () => {
      expect(eligibleStylesForCompany(fits, 81)).toEqual([]);
    });

    it('fits 에 없는 스타일은 자동 제외(부분 데이터 안전)', () => {
      const partial: PhilosophyFitLike[] = [
        { philosophyId: 'BUFFETT', computable: true, score: 90 },
      ];
      expect(eligibleStylesForCompany(partial)).toEqual(['BUFFETT']);
    });

    it('isStyleEligible 은 단건 질의로 일관', () => {
      expect(isStyleEligible('BUFFETT', fits)).toBe(true);
      expect(isStyleEligible('LYNCH', fits)).toBe(false);
      expect(isStyleEligible('GREENBLATT', fits)).toBe(false);
    });
  });

  describe('rankStyles (비교 랭킹)', () => {
    it('누적수익률 내림차순 정렬 + 표본 있는 최고를 bestStyle 로', () => {
      const rows: StyleReturnRow[] = [
        { style: 'BUFFETT', cumulativeReturnPct: 5, sampleSize: 10 },
        { style: 'LYNCH', cumulativeReturnPct: 12, sampleSize: 8 },
        { style: 'GREENBLATT', cumulativeReturnPct: -3, sampleSize: 6 },
        { style: 'DRUCKENMILLER', cumulativeReturnPct: 0, sampleSize: 7 },
      ];
      const r = rankStyles(rows);
      expect(r.ranking).toEqual(['LYNCH', 'BUFFETT', 'DRUCKENMILLER', 'GREENBLATT']);
      expect(r.bestStyle).toBe('LYNCH');
      expect(r.allLowSample).toBe(false);
    });

    it('표본 0인 스타일은 bestStyle 후보에서 제외(거짓 우승 방지)', () => {
      const rows: StyleReturnRow[] = [
        { style: 'BUFFETT', cumulativeReturnPct: 99, sampleSize: 0 }, // 표본 없음
        { style: 'LYNCH', cumulativeReturnPct: 3, sampleSize: 10 },
      ];
      const r = rankStyles(rows);
      // 정렬엔 포함되나 우승은 표본 있는 LYNCH
      expect(r.ranking[0]).toBe('BUFFETT');
      expect(r.bestStyle).toBe('LYNCH');
    });

    it('표본 있는 스타일이 모두 임계 미만이면 allLowSample=true(과신 금지)', () => {
      const rows: StyleReturnRow[] = PHILOSOPHY_STYLES.map((style) => ({
        style,
        cumulativeReturnPct: 1,
        sampleSize: STYLE_LOW_SAMPLE_THRESHOLD - 1,
      }));
      const r = rankStyles(rows);
      expect(r.allLowSample).toBe(true);
      expect(r.bestStyle).not.toBeNull(); // 우승은 있되 과신 배지로 경고
    });

    it('표본 있는 스타일이 하나도 없으면 bestStyle=null·allLowSample=true', () => {
      const rows: StyleReturnRow[] = PHILOSOPHY_STYLES.map((style) => ({
        style,
        cumulativeReturnPct: 0,
        sampleSize: 0,
      }));
      const r = rankStyles(rows);
      expect(r.bestStyle).toBeNull();
      expect(r.allLowSample).toBe(true);
    });

    it('동률은 PHILOSOPHY_STYLES 순서로 안정 정렬', () => {
      const rows: StyleReturnRow[] = [
        { style: 'DRUCKENMILLER', cumulativeReturnPct: 5, sampleSize: 6 },
        { style: 'BUFFETT', cumulativeReturnPct: 5, sampleSize: 6 },
      ];
      expect(rankStyles(rows).ranking).toEqual(['BUFFETT', 'DRUCKENMILLER']);
    });
  });
});
