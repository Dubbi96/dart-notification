/**
 * fundamental.scorer.spec.ts — DAR-100
 *
 * 사장되던 재무 성장률(DAR-93)·본문 정량값(DAR-95)을 매수신호 입력으로 활성화한
 * 순수 Rule scorer 검증:
 *  1) 성장률 가점·역성장 감점(대칭 단조)
 *  2) 본문 정량값(계약규모 가점·희석률 감점)
 *  3) 결측(전무·전필드 null) → 0 안전 + hasFundamentalData=false (재정규화 제외)
 *  4) 가용 신호만 가중평균(결측 신호는 분모 제외)
 *
 * AI 금지영역: 순수 Rule 검증.
 */

import {
  scoreFundamental,
  hasFundamentalData,
  FundamentalInput,
} from './fundamental.scorer';

const EMPTY: FundamentalInput = { growth: null, filedFacts: null };

describe('scoreFundamental()', () => {
  it('결측(성장률·정량값 전무) → 0', () => {
    expect(scoreFundamental(EMPTY)).toBe(0);
  });

  it('성장률 전필드 null + 정량값 전필드 null → 0', () => {
    expect(
      scoreFundamental({
        growth: {
          revenueGrowthYoY: null,
          operatingProfitGrowthYoY: null,
          epsGrowthYoY: null,
        },
        filedFacts: { contractToSalesRatio: null, dilutionRate: null },
      }),
    ).toBe(0);
  });

  it('고성장(매출·영업이익·EPS 양호) → 강한 양(+) 점수', () => {
    const score = scoreFundamental({
      growth: {
        revenueGrowthYoY: 40,
        operatingProfitGrowthYoY: 35,
        epsGrowthYoY: 25,
      },
      filedFacts: null,
    });
    // growthPoints: 40→75, 35→75, 25→50. 가중평균 (0.3·75+0.3·75+0.15·50)/0.75 = 70
    expect(score).toBe(70);
  });

  it('역성장 → 음(-) 점수', () => {
    const score = scoreFundamental({
      growth: {
        revenueGrowthYoY: -20,
        operatingProfitGrowthYoY: -40,
        epsGrowthYoY: -10,
      },
      filedFacts: null,
    });
    // growthPoints: -20→-70, -40→-100, -10→-40. (0.3·-70+0.3·-100+0.15·-40)/0.75 = -76
    expect(score).toBe(-76);
  });

  it('대형 계약(계약금액/매출 비율 큼) → 양(+) 가점', () => {
    const score = scoreFundamental({
      growth: null,
      filedFacts: { contractToSalesRatio: 50, dilutionRate: null },
    });
    // contractSizePoints(50)=100, 단일 신호 → 100
    expect(score).toBe(100);
  });

  it('높은 희석률(CB/유증 본문) → 음(-) 감점', () => {
    const score = scoreFundamental({
      growth: null,
      filedFacts: { contractToSalesRatio: null, dilutionRate: 30 },
    });
    // dilutionPoints(30)=-100, 단일 신호 → -100
    expect(score).toBe(-100);
  });

  it('가용 신호만 가중평균 — 결측 신호는 분모에서 제외', () => {
    // 매출 성장만 존재(40→75). 다른 성장·정량값 결측 → 단일 신호 점수 그대로.
    const score = scoreFundamental({
      growth: {
        revenueGrowthYoY: 40,
        operatingProfitGrowthYoY: null,
        epsGrowthYoY: null,
      },
      filedFacts: null,
    });
    expect(score).toBe(75);
  });

  it('성장 가점 + 희석 감점 혼합 → 가중 상쇄', () => {
    const score = scoreFundamental({
      growth: {
        revenueGrowthYoY: 50, // 100
        operatingProfitGrowthYoY: null,
        epsGrowthYoY: null,
      },
      filedFacts: { contractToSalesRatio: null, dilutionRate: 30 }, // -100
    });
    // (0.3·100 + 0.1·-100)/(0.3+0.1) = (30-10)/0.4 = 50
    expect(score).toBe(50);
  });

  it('점수는 항상 -100..100 범위(clamp)', () => {
    const hi = scoreFundamental({
      growth: {
        revenueGrowthYoY: 999,
        operatingProfitGrowthYoY: 999,
        epsGrowthYoY: 999,
      },
      filedFacts: { contractToSalesRatio: 999, dilutionRate: null },
    });
    expect(hi).toBeLessThanOrEqual(100);
    expect(hi).toBeGreaterThanOrEqual(-100);
  });
});

describe('hasFundamentalData()', () => {
  it('null/undefined → false', () => {
    expect(hasFundamentalData(null)).toBe(false);
    expect(hasFundamentalData(undefined)).toBe(false);
  });

  it('전무·전필드 null → false', () => {
    expect(hasFundamentalData(EMPTY)).toBe(false);
    expect(
      hasFundamentalData({
        growth: {
          revenueGrowthYoY: null,
          operatingProfitGrowthYoY: null,
          epsGrowthYoY: null,
        },
        filedFacts: { contractToSalesRatio: null, dilutionRate: null },
      }),
    ).toBe(false);
  });

  it('성장률 1필드라도 유효 → true', () => {
    expect(
      hasFundamentalData({
        growth: {
          revenueGrowthYoY: 5,
          operatingProfitGrowthYoY: null,
          epsGrowthYoY: null,
        },
        filedFacts: null,
      }),
    ).toBe(true);
  });

  it('본문 정량값 1필드라도 유효 → true', () => {
    expect(
      hasFundamentalData({
        growth: null,
        filedFacts: { contractToSalesRatio: null, dilutionRate: 8 },
      }),
    ).toBe(true);
  });

  it('NaN/Infinity 는 결측 취급', () => {
    expect(
      hasFundamentalData({
        growth: {
          revenueGrowthYoY: NaN,
          operatingProfitGrowthYoY: Infinity,
          epsGrowthYoY: null,
        },
        filedFacts: null,
      }),
    ).toBe(false);
  });
});
