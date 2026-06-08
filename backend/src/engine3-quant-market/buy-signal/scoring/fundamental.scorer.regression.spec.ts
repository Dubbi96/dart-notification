// 회귀 안전망 (DAR-127): 펀더멘털 점수 — 역성장 감점·본문 정량 가점/감점·결측 분모제외.
// 기존 fundamental.scorer.spec.ts를 보완(역성장 전 구간·정량 tier·가중평균 합성).
import {
  scoreFundamental,
  hasFundamentalData,
  FundamentalInput,
} from './fundamental.scorer';

const onlyGrowth = (revenueGrowthYoY: number): FundamentalInput => ({
  growth: { revenueGrowthYoY, operatingProfitGrowthYoY: null, epsGrowthYoY: null },
  filedFacts: null,
});

describe('scoreFundamental (DAR-127 회귀 안전망)', () => {
  describe('성장률 → 점수 단조(대칭 가점/감점)', () => {
    it.each([
      [60, 100],
      [50, 100],
      [30, 75],
      [15, 50],
      [5, 25],
      [0, 10],
      [-3, -10],
      [-5, -10],
      [-10, -40],
      [-15, -40],
      [-25, -70],
      [-30, -70],
      [-50, -100],
      [-80, -100],
    ])('revenueGrowthYoY=%p → %p', (g, expected) => {
      expect(scoreFundamental(onlyGrowth(g))).toBe(expected);
    });
  });

  describe('본문 정량값 — 계약/매출 가점(감점 없음)', () => {
    it.each([
      [50, 100],
      [30, 80],
      [10, 50],
      [5, 25],
      [1, 10],
      [0.5, 0],
    ])('contractToSalesRatio=%p → %p', (ratio, expected) => {
      expect(
        scoreFundamental({
          growth: null,
          filedFacts: { contractToSalesRatio: ratio, dilutionRate: null },
        }),
      ).toBe(expected);
    });
  });

  describe('본문 정량값 — 희석률 감점(가점 없음)', () => {
    it.each([
      [30, -100],
      [20, -70],
      [10, -40],
      [5, -20],
      [1, 0],
    ])('dilutionRate=%p → %p', (rate, expected) => {
      expect(
        scoreFundamental({
          growth: null,
          filedFacts: { contractToSalesRatio: null, dilutionRate: rate },
        }),
      ).toBe(expected);
    });
  });

  describe('가중평균 합성 — 결측 신호는 분모에서 제외', () => {
    it('매출 +100(w0.3) · 희석 -100(w0.1) → (0.3*100 + 0.1*-100)/0.4 = 50', () => {
      const score = scoreFundamental({
        growth: { revenueGrowthYoY: 60, operatingProfitGrowthYoY: null, epsGrowthYoY: null },
        filedFacts: { contractToSalesRatio: null, dilutionRate: 30 },
      });
      expect(score).toBe(50);
    });

    it('단일 신호만 있으면 분모=그 가중치 → 점수=그 신호 점수', () => {
      expect(
        scoreFundamental({
          growth: { revenueGrowthYoY: null, operatingProfitGrowthYoY: 15, epsGrowthYoY: null },
          filedFacts: null,
        }),
      ).toBe(50);
    });

    it('정수 반올림 적용', () => {
      // revenue +25(w0.3), eps +10(w0.15) → (0.3*25 + 0.15*10)/0.45 = 20
      const score = scoreFundamental({
        growth: { revenueGrowthYoY: 5, operatingProfitGrowthYoY: null, epsGrowthYoY: 0 },
        filedFacts: null,
      });
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  describe('결측 → 0(중립) + hasFundamentalData', () => {
    it('input 전체 결측 → 0', () => {
      expect(scoreFundamental({ growth: null, filedFacts: null })).toBe(0);
    });
    it('growth 전 필드 null + filedFacts null → 0', () => {
      expect(
        scoreFundamental({
          growth: { revenueGrowthYoY: null, operatingProfitGrowthYoY: null, epsGrowthYoY: null },
          filedFacts: { contractToSalesRatio: null, dilutionRate: null },
        }),
      ).toBe(0);
    });
    it('hasFundamentalData: 결측이면 false', () => {
      expect(hasFundamentalData(null)).toBe(false);
      expect(hasFundamentalData(undefined)).toBe(false);
      expect(hasFundamentalData({ growth: null, filedFacts: null })).toBe(false);
    });
    it('hasFundamentalData: 유효 수치 하나라도 있으면 true', () => {
      expect(hasFundamentalData(onlyGrowth(10))).toBe(true);
    });
    it('비유한값(Infinity/NaN)은 무효 처리', () => {
      expect(
        hasFundamentalData({
          growth: {
            revenueGrowthYoY: Infinity,
            operatingProfitGrowthYoY: NaN,
            epsGrowthYoY: null,
          },
          filedFacts: null,
        }),
      ).toBe(false);
    });
  });
});
