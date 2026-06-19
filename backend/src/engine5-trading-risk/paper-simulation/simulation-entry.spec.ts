/**
 * simulation-entry.spec.ts — 모의운용 진입 기준 단위테스트 (DAR-51, DB 미사용)
 *
 * 진입 자격 등급 확장(WATCH 포함)·등급별 차등 사이징·검증 메타가 순수 Rule로 동작함을 고정.
 */

import {
  SIM_MIN_ENTRY_GRADE,
  GRADE_RANK,
  entryEligibleGrades,
  isEntryEligibleGrade,
  gradeSizingFactor,
  GRADE_SIZING_FACTOR,
  entryBudget,
  buildEntryMeta,
  buyScoreSizingMultiplier,
  entrySizingFactor,
  entryBudgetScored,
  sectorHeadroomBudget,
  SIZING_SCORE_REF_HIGH,
  SIZING_SCORE_REF_LOW,
  SIZING_SCORE_MULT_FLOOR,
  ENTRY_FALLBACK_MIN_BUY_SCORE,
} from './simulation-entry';

describe('simulation-entry — 진입 기준(DAR-51)', () => {
  it('기본 최소등급은 WATCH', () => {
    expect(SIM_MIN_ENTRY_GRADE).toBe('WATCH');
  });

  describe('entryEligibleGrades', () => {
    it('기본(WATCH)이면 WATCH·BUY·STRONG_BUY 후보 포함, NEUTRAL/AVOID/BLOCKED 제외', () => {
      const grades = entryEligibleGrades();
      expect(grades).toEqual(
        expect.arrayContaining(['STRONG_BUY_CANDIDATE', 'BUY_CANDIDATE', 'WATCH']),
      );
      expect(grades).not.toContain('NEUTRAL');
      expect(grades).not.toContain('AVOID');
      expect(grades).not.toContain('BLOCKED');
    });

    it('최소등급을 BUY_CANDIDATE로 올리면 WATCH 제외(설정 조정 가능)', () => {
      const grades = entryEligibleGrades('BUY_CANDIDATE');
      expect(grades).toEqual(
        expect.arrayContaining(['STRONG_BUY_CANDIDATE', 'BUY_CANDIDATE']),
      );
      expect(grades).not.toContain('WATCH');
    });
  });

  describe('isEntryEligibleGrade', () => {
    it('WATCH 기준: WATCH 이상은 자격, 미만은 비자격', () => {
      expect(isEntryEligibleGrade('STRONG_BUY_CANDIDATE')).toBe(true);
      expect(isEntryEligibleGrade('BUY_CANDIDATE')).toBe(true);
      expect(isEntryEligibleGrade('WATCH')).toBe(true);
      expect(isEntryEligibleGrade('NEUTRAL')).toBe(false);
      expect(isEntryEligibleGrade('AVOID')).toBe(false);
      expect(isEntryEligibleGrade('BLOCKED')).toBe(false);
    });

    it('알 수 없는 등급은 비자격', () => {
      expect(isEntryEligibleGrade('UNKNOWN')).toBe(false);
    });
  });

  describe('gradeSizingFactor — 등급별 차등(WATCH는 작게)', () => {
    it('STRONG_BUY > BUY > WATCH 순으로 작아짐', () => {
      expect(gradeSizingFactor('STRONG_BUY_CANDIDATE')).toBeGreaterThan(
        gradeSizingFactor('BUY_CANDIDATE'),
      );
      expect(gradeSizingFactor('BUY_CANDIDATE')).toBeGreaterThan(
        gradeSizingFactor('WATCH'),
      );
    });

    it('WATCH 계수는 1.0 미만(소액 검증 진입)', () => {
      expect(gradeSizingFactor('WATCH')).toBeLessThan(1.0);
      expect(gradeSizingFactor('WATCH')).toBe(GRADE_SIZING_FACTOR.WATCH);
    });

    it('미정의 등급은 WATCH 계수로 폴백', () => {
      expect(gradeSizingFactor('NEUTRAL')).toBe(GRADE_SIZING_FACTOR.WATCH);
    });
  });

  describe('entryBudget — 차등 예산', () => {
    const BASE = 1_000_000;
    it('STRONG_BUY는 기본예산 전액, WATCH는 축소', () => {
      expect(entryBudget(BASE, 'STRONG_BUY_CANDIDATE')).toBe(BASE);
      expect(entryBudget(BASE, 'WATCH')).toBe(BASE * GRADE_SIZING_FACTOR.WATCH);
      expect(entryBudget(BASE, 'WATCH')).toBeLessThan(entryBudget(BASE, 'STRONG_BUY_CANDIDATE'));
    });

    it('0/음수 기본예산은 0으로 가드', () => {
      expect(entryBudget(0, 'WATCH')).toBe(0);
      expect(entryBudget(-100, 'STRONG_BUY_CANDIDATE')).toBe(0);
    });
  });

  describe('buildEntryMeta — 검증 메타(등급별 수익률 분석용)', () => {
    it('grade·buyScore·sizingFactor를 캡처', () => {
      const meta = buildEntryMeta('WATCH', 41);
      expect(meta).toEqual({
        grade: 'WATCH',
        buyScore: 41,
        sizingFactor: GRADE_SIZING_FACTOR.WATCH,
      });
    });
  });

  it('GRADE_RANK는 schema.prisma enum SignalGrade 6종과 1:1', () => {
    expect(Object.keys(GRADE_RANK).sort()).toEqual(
      ['AVOID', 'BLOCKED', 'BUY_CANDIDATE', 'NEUTRAL', 'STRONG_BUY_CANDIDATE', 'WATCH'].sort(),
    );
  });

  // ─── DAR-362: buyScore 차등 사이징 ──────────────────────────────────────
  describe('buyScoreSizingMultiplier — buyScore 확신도 가중(고확신 더, 저확신 덜)', () => {
    it('HIGH 이상은 1.0, LOW 이하는 FLOOR, 사이는 단조 증가', () => {
      expect(buyScoreSizingMultiplier(SIZING_SCORE_REF_HIGH)).toBe(1.0);
      expect(buyScoreSizingMultiplier(100)).toBe(1.0);
      expect(buyScoreSizingMultiplier(SIZING_SCORE_REF_LOW)).toBe(SIZING_SCORE_MULT_FLOOR);
      expect(buyScoreSizingMultiplier(0)).toBe(SIZING_SCORE_MULT_FLOOR);
      expect(buyScoreSizingMultiplier(-100)).toBe(SIZING_SCORE_MULT_FLOOR);
      const mid = buyScoreSizingMultiplier(50);
      expect(mid).toBeGreaterThan(SIZING_SCORE_MULT_FLOOR);
      expect(mid).toBeLessThan(1.0);
    });

    it('항상 (0, 1] 범위 — 가중이 등급계수를 상향(하드룰 우회)하지 못함', () => {
      for (const s of [-50, 0, 20, 30, 55, 80, 88, 100]) {
        const m = buyScoreSizingMultiplier(s);
        expect(m).toBeGreaterThan(0);
        expect(m).toBeLessThanOrEqual(1.0);
      }
    });

    it('단조 증가(buyScore 클수록 가중 큼)', () => {
      expect(buyScoreSizingMultiplier(30)).toBeLessThan(buyScoreSizingMultiplier(60));
      expect(buyScoreSizingMultiplier(60)).toBeLessThan(buyScoreSizingMultiplier(79));
    });

    it('비유한 입력은 FLOOR로 가드', () => {
      expect(buyScoreSizingMultiplier(NaN)).toBe(SIZING_SCORE_MULT_FLOOR);
    });
  });

  describe('entrySizingFactor / entryBudgetScored — 등급×buyScore 결합 차등', () => {
    const BASE = 1_000_000;
    it('결합계수 = 등급계수 × buyScore가중, 항상 등급계수 이내', () => {
      const f = entrySizingFactor('WATCH', 88);
      expect(f).toBe(gradeSizingFactor('WATCH') * buyScoreSizingMultiplier(88));
      expect(f).toBeLessThanOrEqual(gradeSizingFactor('WATCH'));
    });

    it('★균일 탈피: 동일 WATCH 등급이라도 buyScore가 다르면 예산이 차등', () => {
      const hi = entryBudgetScored(BASE, 'WATCH', 88);
      const lo = entryBudgetScored(BASE, 'WATCH', 30);
      expect(hi).toBeGreaterThan(lo);
    });

    it('예산은 항상 baseBudget(=단일종목 최대비중 예산) 이내 — Risk 하드룰 보존', () => {
      for (const g of ['STRONG_BUY_CANDIDATE', 'BUY_CANDIDATE', 'WATCH']) {
        for (const s of [30, 60, 88, 100]) {
          expect(entryBudgetScored(BASE, g, s)).toBeLessThanOrEqual(BASE);
        }
      }
    });

    it('0/음수 기본예산은 0으로 가드', () => {
      expect(entryBudgetScored(0, 'WATCH', 80)).toBe(0);
      expect(entryBudgetScored(-1, 'STRONG_BUY_CANDIDATE', 100)).toBe(0);
    });
  });

  // ─── DAR-362: 섹터 분산 가드 ────────────────────────────────────────────
  describe('sectorHeadroomBudget — 섹터 비중 상한 잔여 예산', () => {
    const TOTAL = 10_000_000;
    const MAX_SECTOR = 30; // 30% → 섹터 cap 300만

    it('빈 섹터는 cap 전액 허용', () => {
      expect(sectorHeadroomBudget(0, TOTAL, MAX_SECTOR)).toBe(3_000_000);
    });

    it('일부 보유 섹터는 잔여만 허용', () => {
      expect(sectorHeadroomBudget(2_000_000, TOTAL, MAX_SECTOR)).toBe(1_000_000);
    });

    it('상한 도달/초과 섹터는 0(더 못 담음)', () => {
      expect(sectorHeadroomBudget(3_000_000, TOTAL, MAX_SECTOR)).toBe(0);
      expect(sectorHeadroomBudget(5_000_000, TOTAL, MAX_SECTOR)).toBe(0);
    });

    it('음수 입력/0 총액·상한은 0으로 가드', () => {
      expect(sectorHeadroomBudget(-100, TOTAL, MAX_SECTOR)).toBe(3_000_000);
      expect(sectorHeadroomBudget(0, 0, MAX_SECTOR)).toBe(0);
      expect(sectorHeadroomBudget(0, TOTAL, 0)).toBe(0);
    });
  });

  it('ENTRY_FALLBACK_MIN_BUY_SCORE 는 품질 하한(0 초과·무차별 확대 아님)', () => {
    expect(ENTRY_FALLBACK_MIN_BUY_SCORE).toBeGreaterThan(0);
  });
});
