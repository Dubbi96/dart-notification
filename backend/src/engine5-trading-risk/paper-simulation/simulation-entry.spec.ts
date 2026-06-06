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
});
