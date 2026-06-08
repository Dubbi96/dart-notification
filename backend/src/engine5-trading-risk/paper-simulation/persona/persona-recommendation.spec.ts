/**
 * persona-recommendation.spec.ts — '현재 장 적합 persona' 추천 순수 Rule 검증 (DAR-130)
 *
 * 레짐 적합도 룰·성과 점수·복합 가중(표본<30 미유의 시 레짐 위주)·1~2 추천·결정론을 검증한다.
 */

import {
  regimeFitScore,
  performanceScore,
  recommendPersonas,
  PersonaPerformanceRow,
  PERSONA_ARCHETYPE,
  PERF_RELIABLE_SAMPLE,
} from './persona-recommendation';
import { MarketRegime } from './market-regime';

function regime(
  over: Partial<MarketRegime> = {},
): MarketRegime {
  return {
    trend: 'SIDEWAYS',
    volatility: 'NORMAL',
    eventSkew: 'BALANCED',
    trendChangePct: 0,
    dailyVolatilityPct: 0.8,
    indexSampleSize: 40,
    eventSampleSize: 50,
    eventPolarity: { positive: 0, negative: 0, mixed: 0, unknown: 50 },
    classifiable: true,
    dataLimited: false,
    asOf: '20260608',
    ...over,
  };
}

const rows = (
  partials: Array<Partial<PersonaPerformanceRow> & { style: PersonaPerformanceRow['style'] }>,
): PersonaPerformanceRow[] =>
  partials.map((p) => ({
    cumulativeReturnPct: 0,
    mddPct: null,
    hitRatePct: 0,
    sampleSize: 0,
    ...p,
  }));

describe('persona-recommendation 순수 Rule (DAR-130)', () => {
  it('PERSONA_ARCHETYPE — 4 persona ↔ 아키타입 매핑', () => {
    expect(PERSONA_ARCHETYPE).toEqual({
      BUFFETT: 'VALUE',
      LYNCH: 'GROWTH',
      GREENBLATT: 'QUANTITATIVE',
      DRUCKENMILLER: 'MACRO',
    });
  });

  describe('regimeFitScore (0~100 클램프)', () => {
    it('강한 상승·고변동·호재장 → 드러켄밀러(MACRO) 최고', () => {
      const r = regime({ trend: 'UPTREND', volatility: 'HIGH', eventSkew: 'OPPORTUNITY' });
      const druck = regimeFitScore('DRUCKENMILLER', r);
      const buffett = regimeFitScore('BUFFETT', r);
      expect(druck).toBeGreaterThan(buffett);
      expect(druck).toBeLessThanOrEqual(100);
    });
    it('하락·저변동·악재장 → 버핏(VALUE) 우위', () => {
      const r = regime({ trend: 'DOWNTREND', volatility: 'LOW', eventSkew: 'RISK_HEAVY' });
      expect(regimeFitScore('BUFFETT', r)).toBeGreaterThan(
        regimeFitScore('DRUCKENMILLER', r),
      );
    });
    it('항상 0~100 범위', () => {
      const r = regime({ trend: 'SIDEWAYS', volatility: 'LOW', eventSkew: 'BALANCED' });
      for (const s of ['BUFFETT', 'LYNCH', 'GREENBLATT', 'DRUCKENMILLER'] as const) {
        const v = regimeFitScore(s, r);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('performanceScore', () => {
    it('수익률↑·MDD 얕음·적중률↑ → 높은 점수', () => {
      const high = performanceScore({
        style: 'LYNCH',
        cumulativeReturnPct: 25,
        mddPct: 0,
        hitRatePct: 100,
        sampleSize: 40,
      });
      const low = performanceScore({
        style: 'LYNCH',
        cumulativeReturnPct: -25,
        mddPct: -40,
        hitRatePct: 0,
        sampleSize: 40,
      });
      expect(high).toBeGreaterThan(low);
      expect(high).toBeLessThanOrEqual(100);
      expect(low).toBeGreaterThanOrEqual(0);
    });
    it('MDD 측정 불가(null) → 중립 50 처리', () => {
      const v = performanceScore({
        style: 'LYNCH',
        cumulativeReturnPct: 0,
        mddPct: null,
        hitRatePct: 50,
        sampleSize: 0,
      });
      // returnScore 50, mddScore 50, hitScore 50 → 50
      expect(v).toBeCloseTo(50, 6);
    });
  });

  describe('recommendPersonas', () => {
    it('항상 4 persona 모두 랭크, 1~2개 추천', () => {
      const rec = recommendPersonas(
        rows([
          { style: 'BUFFETT' },
          { style: 'LYNCH' },
          { style: 'GREENBLATT' },
          { style: 'DRUCKENMILLER' },
        ]),
        regime({ trend: 'UPTREND', volatility: 'HIGH', eventSkew: 'OPPORTUNITY' }),
      );
      expect(rec.ranked).toHaveLength(4);
      expect(rec.recommended.length).toBeGreaterThanOrEqual(1);
      expect(rec.recommended.length).toBeLessThanOrEqual(2);
      // 1순위는 추천됨
      expect(rec.ranked[0].recommended).toBe(true);
      expect(rec.recommended[0]).toBe(rec.ranked[0].style);
    });

    it('복합점수 내림차순 정렬', () => {
      const rec = recommendPersonas(
        rows([{ style: 'BUFFETT' }, { style: 'LYNCH' }]),
        regime(),
      );
      for (let i = 1; i < rec.ranked.length; i++) {
        expect(rec.ranked[i - 1].compositeScore).toBeGreaterThanOrEqual(
          rec.ranked[i].compositeScore,
        );
      }
    });

    it('성과 표본<30 → lowSample=true, 레짐 위주(복합=0.75×레짐+0.25×성과)', () => {
      const r = regime({ trend: 'UPTREND', volatility: 'HIGH', eventSkew: 'OPPORTUNITY' });
      const rec = recommendPersonas(
        rows([{ style: 'DRUCKENMILLER', sampleSize: PERF_RELIABLE_SAMPLE - 1 }]),
        r,
      );
      const druck = rec.ranked.find((x) => x.style === 'DRUCKENMILLER')!;
      expect(druck.lowSample).toBe(true);
      const expected =
        0.75 * druck.regimeFitScore + 0.25 * druck.performanceScore;
      expect(druck.compositeScore).toBeCloseTo(expected, 6);
    });

    it('성과 표본≥30 → 신뢰(복합=0.5×레짐+0.5×성과)', () => {
      const r = regime();
      const rec = recommendPersonas(
        rows([{ style: 'GREENBLATT', sampleSize: PERF_RELIABLE_SAMPLE, hitRatePct: 60 }]),
        r,
      );
      const g = rec.ranked.find((x) => x.style === 'GREENBLATT')!;
      expect(g.lowSample).toBe(false);
      expect(g.compositeScore).toBeCloseTo(
        0.5 * g.regimeFitScore + 0.5 * g.performanceScore,
        6,
      );
    });

    it('레짐 미유의 또는 모든 persona 표본<30 → dataLimited=true', () => {
      const rec = recommendPersonas(
        rows([{ style: 'BUFFETT' }, { style: 'LYNCH' }]),
        regime({ dataLimited: false }),
      );
      // 모든 성과 표본 0 → allLowSample → dataLimited
      expect(rec.dataLimited).toBe(true);
    });

    it('근거(rationale) 노출 — persona별 비어있지 않음', () => {
      const rec = recommendPersonas(
        rows([{ style: 'BUFFETT' }]),
        regime({ trend: 'DOWNTREND', volatility: 'LOW', eventSkew: 'RISK_HEAVY' }),
      );
      for (const p of rec.ranked) {
        expect(p.rationale.length).toBeGreaterThan(0);
      }
    });

    it('결정론: 동일 입력 → 동일 출력', () => {
      const input = rows([
        { style: 'BUFFETT', cumulativeReturnPct: 5, sampleSize: 35, hitRatePct: 55, mddPct: -10 },
        { style: 'DRUCKENMILLER', cumulativeReturnPct: 12, sampleSize: 32, hitRatePct: 60, mddPct: -20 },
      ]);
      const r = regime({ trend: 'UPTREND', volatility: 'HIGH' });
      expect(recommendPersonas(input, r)).toEqual(recommendPersonas(input, r));
    });
  });
});
