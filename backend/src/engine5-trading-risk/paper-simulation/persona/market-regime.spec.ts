/**
 * market-regime.spec.ts — 시장 레짐 분류 순수 Rule 검증 (DAR-130)
 *
 * 결정론: 동일 입력 → 동일 출력. 표본 부족 graceful·임계 경계·dataLimited(표본<30) 검증.
 */

import {
  trendChangePct,
  dailyVolatilityPct,
  classifyTrend,
  classifyVolatility,
  classifyEventSkew,
  detectMarketRegime,
  EventPolarityCounts,
  REGIME_MIN_INDEX_SAMPLE,
  SIGNIFICANT_SAMPLE_THRESHOLD,
} from './market-regime';

const flat = (n: number, value = 100): number[] => Array(n).fill(value);
const ramp = (n: number, start: number, step: number): number[] =>
  Array.from({ length: n }, (_, i) => start + i * step);

const polarity = (
  p: Partial<EventPolarityCounts>,
): EventPolarityCounts => ({
  positive: 0,
  negative: 0,
  mixed: 0,
  unknown: 0,
  ...p,
});

describe('market-regime 순수 Rule (DAR-130)', () => {
  describe('trendChangePct', () => {
    it('표본<2 또는 시작값≤0 이면 null', () => {
      expect(trendChangePct([])).toBeNull();
      expect(trendChangePct([100])).toBeNull();
      expect(trendChangePct([0, 100])).toBeNull();
    });
    it('누적 변화율(%) 계산', () => {
      expect(trendChangePct([100, 110])).toBeCloseTo(10, 6);
      expect(trendChangePct([100, 90])).toBeCloseTo(-10, 6);
    });
  });

  describe('classifyTrend (임계 ±3%)', () => {
    it('null → SIDEWAYS', () => expect(classifyTrend(null)).toBe('SIDEWAYS'));
    it('+3% 경계 포함 → UPTREND', () =>
      expect(classifyTrend(3)).toBe('UPTREND'));
    it('-3% 경계 포함 → DOWNTREND', () =>
      expect(classifyTrend(-3)).toBe('DOWNTREND'));
    it('중간 → SIDEWAYS', () => expect(classifyTrend(1)).toBe('SIDEWAYS'));
  });

  describe('dailyVolatilityPct / classifyVolatility (임계 0.6/1.5%)', () => {
    it('수익률 표본<2 이면 null → NORMAL', () => {
      expect(dailyVolatilityPct([100])).toBeNull();
      expect(classifyVolatility(null)).toBe('NORMAL');
    });
    it('완전 평탄 → 변동성 0% → LOW', () => {
      const v = dailyVolatilityPct(flat(10));
      expect(v).toBeCloseTo(0, 6);
      expect(classifyVolatility(v)).toBe('LOW');
    });
    it('고변동 → HIGH', () => {
      // 100→105→100→105… 변동성 큼
      const series = [100, 105, 100, 105, 100, 105];
      const v = dailyVolatilityPct(series);
      expect(v).not.toBeNull();
      expect(classifyVolatility(v)).toBe('HIGH');
    });
    it('경계값 직접 분류', () => {
      expect(classifyVolatility(1.5)).toBe('HIGH');
      expect(classifyVolatility(0.6)).toBe('LOW');
      expect(classifyVolatility(1.0)).toBe('NORMAL');
    });
  });

  describe('classifyEventSkew (비율 1.5x)', () => {
    it('표본 0 → BALANCED', () =>
      expect(classifyEventSkew(polarity({}))).toBe('BALANCED'));
    it('악재 우세 → RISK_HEAVY', () =>
      expect(classifyEventSkew(polarity({ positive: 10, negative: 20 }))).toBe(
        'RISK_HEAVY',
      ));
    it('호재 우세 → OPPORTUNITY', () =>
      expect(classifyEventSkew(polarity({ positive: 20, negative: 10 }))).toBe(
        'OPPORTUNITY',
      ));
    it('혼조(비율 미달) → BALANCED', () =>
      expect(classifyEventSkew(polarity({ positive: 12, negative: 10 }))).toBe(
        'BALANCED',
      ));
  });

  describe('detectMarketRegime 종합', () => {
    it('지수 표본 < 최소치 → classifiable=false, 추세/변동성 기본값', () => {
      const r = detectMarketRegime({
        indexCloses: flat(REGIME_MIN_INDEX_SAMPLE - 1),
        eventPolarity: polarity({ positive: 40 }),
      });
      expect(r.classifiable).toBe(false);
      expect(r.trend).toBe('SIDEWAYS');
      expect(r.volatility).toBe('NORMAL');
      expect(r.trendChangePct).toBeNull();
    });

    it('표본<30(지수 또는 이벤트) → dataLimited=true', () => {
      const r = detectMarketRegime({
        indexCloses: ramp(10, 100, 1),
        eventPolarity: polarity({ positive: 5 }),
      });
      expect(r.dataLimited).toBe(true);
    });

    it('충분한 표본 → dataLimited=false, 상승추세 분류', () => {
      const r = detectMarketRegime({
        indexCloses: ramp(SIGNIFICANT_SAMPLE_THRESHOLD + 5, 2500, 5),
        eventPolarity: polarity({ positive: 40, negative: 10 }),
      });
      expect(r.classifiable).toBe(true);
      expect(r.dataLimited).toBe(false);
      expect(r.trend).toBe('UPTREND');
      expect(r.eventSkew).toBe('OPPORTUNITY');
      expect(r.eventSampleSize).toBe(50);
    });

    it('결정론: 동일 입력 → 동일 출력', () => {
      const input = {
        indexCloses: ramp(35, 2500, -4),
        eventPolarity: polarity({ negative: 40 }),
        asOf: '20260608',
      };
      expect(detectMarketRegime(input)).toEqual(detectMarketRegime(input));
    });
  });
});
