/**
 * bucket-renormalization.spec.ts — DAR-49
 *
 * 결측 버킷 제외 가중치 재정규화 검증:
 *  1) 전버킷 가용 → 기존 가중치 그대로(산식 의미 비트단위 보존)
 *  2) 일부 결측 → 가용 가중치 합=1.0 으로 재정규화
 *  3) 전부 결측 → 방어(모든 가중치 0, 크래시 없음)
 *
 * AI 금지영역: 순수 Rule 검증.
 */

import { BUY_SCORE_WEIGHTS } from '../config/buy-signal.config';
import {
  BucketAvailability,
  BucketKey,
  detectBucketAvailability,
  renormalizeWeights,
} from './bucket-renormalization';

const ALL_KEYS: BucketKey[] = [
  'disclosureEvent',
  'keyMetric',
  'personaFit',
  'historicalEvent',
  'chart',
  'volumeLiquidity',
  'marketSector',
];

function availabilityOf(overrides: Partial<BucketAvailability>): BucketAvailability {
  const base = ALL_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: true }),
    {} as BucketAvailability,
  );
  return { ...base, ...overrides };
}

function sum(weights: Record<BucketKey, number>): number {
  return ALL_KEYS.reduce((s, k) => s + weights[k], 0);
}

describe('renormalizeWeights()', () => {
  const W = { ...BUY_SCORE_WEIGHTS };

  it('전버킷 가용 → 기존 가중치를 그대로 반환(회귀 0)', () => {
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(
      W,
      availabilityOf({}),
    );
    expect(omittedBuckets).toEqual([]);
    // 비트단위 동일
    for (const k of ALL_KEYS) {
      expect(effectiveWeights[k]).toBe(W[k]);
    }
  });

  it('chart + historicalEvent 결측(근본원인 25%) → 가용 가중치 합 1.0 재정규화', () => {
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(
      W,
      availabilityOf({ chart: false, historicalEvent: false }),
    );
    expect(omittedBuckets.sort()).toEqual(['chart', 'historicalEvent']);
    // 결측 버킷 가중치 = 0
    expect(effectiveWeights.chart).toBe(0);
    expect(effectiveWeights.historicalEvent).toBe(0);
    // 가용 버킷 가중치 합 = 1.0
    expect(sum(effectiveWeights)).toBeCloseTo(1.0, 10);
    // 가용 버킷 간 상대 비율은 보존 (disclosureEvent : keyMetric = 0.25 : 0.20)
    expect(effectiveWeights.disclosureEvent / effectiveWeights.keyMetric).toBeCloseTo(
      W.disclosureEvent / W.keyMetric,
      10,
    );
    // 가용 가중치 합 0.75 로 나뉘므로 disclosureEvent = 0.25/0.75
    expect(effectiveWeights.disclosureEvent).toBeCloseTo(0.25 / 0.75, 10);
  });

  it('단일 버킷만 가용 → 그 버킷 가중치 1.0', () => {
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(
      W,
      availabilityOf({
        keyMetric: false,
        personaFit: false,
        historicalEvent: false,
        chart: false,
        volumeLiquidity: false,
        marketSector: false,
      }),
    );
    expect(omittedBuckets.length).toBe(6);
    expect(effectiveWeights.disclosureEvent).toBeCloseTo(1.0, 10);
    expect(sum(effectiveWeights)).toBeCloseTo(1.0, 10);
  });

  it('전부 결측 방어 → 모든 가중치 0, 합 0 (크래시·NaN 없음)', () => {
    const allFalse = ALL_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: false }),
      {} as BucketAvailability,
    );
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(W, allFalse);
    expect(omittedBuckets.length).toBe(7);
    for (const k of ALL_KEYS) {
      expect(effectiveWeights[k]).toBe(0);
      expect(Number.isNaN(effectiveWeights[k])).toBe(false);
    }
    expect(sum(effectiveWeights)).toBe(0);
  });
});

describe('detectBucketAvailability()', () => {
  const fullInput = {
    chart: {
      closePrice: 50000,
      ma5: 48000,
      ma20: 47000,
      ma60: 45000,
      rsi14: 55,
      macdLine: 500,
      macdSignal: 400,
      bollingerMid: 46000,
      preDsclReturn: 2,
    },
    historicalEvent: { avgArD5: 6 },
    volumeLiquidity: {
      volume: 3_000_000,
      avgVolume20: 1_000_000,
      tradingValue: 150_000_000_000,
      avgValue20: 50_000_000_000,
    },
    marketSector: {
      kospiChange1d: 0.5,
      kosdaqChange1d: 0.3,
      sectorChange1d: 0.8,
      vixEquivalent: 15,
    },
    personaFit: {
      personaViews: [{ persona: 'GROWTH', view: 'POSITIVE' }],
      userPersona: 'GROWTH',
    },
  };

  it('전버킷 데이터 완비 → 모두 available', () => {
    const a = detectBucketAvailability(fullInput);
    expect(a).toEqual({
      disclosureEvent: true,
      keyMetric: true,
      personaFit: true,
      historicalEvent: true,
      chart: true,
      volumeLiquidity: true,
      marketSector: true,
    });
  });

  it('technical_indicators 미산출(chart 전필드 null) → chart 결측', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      chart: {
        closePrice: null,
        ma5: null,
        ma20: null,
        ma60: null,
        rsi14: null,
        macdLine: null,
        macdSignal: null,
        bollingerMid: null,
        preDsclReturn: null,
      },
    });
    expect(a.chart).toBe(false);
  });

  it('preDsclReturn 만 있고 지표 전무 → chart 여전히 결측(판별 기준에서 제외)', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      chart: {
        closePrice: null,
        ma5: null,
        ma20: null,
        ma60: null,
        rsi14: null,
        macdLine: null,
        macdSignal: null,
        bollingerMid: null,
        preDsclReturn: 5,
      },
    });
    expect(a.chart).toBe(false);
  });

  it('지표 일부라도 존재 → chart 가용', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      chart: {
        closePrice: null,
        ma5: null,
        ma20: 47000,
        ma60: null,
        rsi14: null,
        macdLine: null,
        macdSignal: null,
        bollingerMid: null,
        preDsclReturn: null,
      },
    });
    expect(a.chart).toBe(true);
  });

  it('event_study 미산출(avgArD5 null) → historicalEvent 결측', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      historicalEvent: { avgArD5: null },
    });
    expect(a.historicalEvent).toBe(false);
  });

  it('volume 필수 4필드 중 하나라도 null → volumeLiquidity 결측', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      volumeLiquidity: {
        volume: 3_000_000,
        avgVolume20: null,
        tradingValue: 150_000_000_000,
        avgValue20: 50_000_000_000,
      },
    });
    expect(a.volumeLiquidity).toBe(false);
  });

  it('시장 지표 전무 → marketSector 결측 (vix만 있어도 결측)', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      marketSector: {
        kospiChange1d: null,
        kosdaqChange1d: null,
        sectorChange1d: null,
        vixEquivalent: 30,
      },
    });
    expect(a.marketSector).toBe(false);
  });

  it('personaViews 비어있음 → personaFit 결측', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      personaFit: { personaViews: [], userPersona: 'GROWTH' },
    });
    expect(a.personaFit).toBe(false);
  });
});
