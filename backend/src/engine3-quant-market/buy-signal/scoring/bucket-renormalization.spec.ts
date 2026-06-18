/**
 * bucket-renormalization.spec.ts — DAR-49 + DAR-88(insider 버킷 편입)
 *
 * 결측 버킷 제외 가중치 재정규화 검증:
 *  1) 전버킷 가용 → 기존 가중치 그대로(산식 의미 비트단위 보존)
 *  2) 일부 결측 → 가용 가중치 합=1.0 으로 재정규화(상대 비율 보존)
 *  3) 전부 결측 → 방어(모든 가중치 0, 크래시 없음)
 *  4) DAR-88: insider 결측(데이터 미적재 종목) → 기존 7버킷 가중치를 정확히 복원(회귀 0)
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
  'insider',
  'fundamental',
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

  it('chart + historicalEvent 결측(근본원인) → 가용 가중치 합 1.0 재정규화', () => {
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
    // 가용 버킷 간 상대 비율은 보존
    expect(
      effectiveWeights.disclosureEvent / effectiveWeights.keyMetric,
    ).toBeCloseTo(W.disclosureEvent / W.keyMetric, 10);
    // 가용 가중치 합으로 나뉜 값과 일치
    const availableSum = ALL_KEYS.filter(
      (k) => k !== 'chart' && k !== 'historicalEvent',
    ).reduce((s, k) => s + W[k], 0);
    expect(effectiveWeights.disclosureEvent).toBeCloseTo(
      W.disclosureEvent / availableSum,
      10,
    );
  });

  it('★DAR-88/100 회귀 0: insider+fundamental 결측 → 기존 7버킷 가중치를 정확히 복원', () => {
    // insider·fundamental 데이터 미적재 종목(대부분의 과거 백테스트/스냅샷) 재현.
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(
      W,
      availabilityOf({ insider: false, fundamental: false }),
    );
    expect(omittedBuckets).toEqual(['insider', 'fundamental']);
    expect(effectiveWeights.insider).toBe(0);
    expect(effectiveWeights.fundamental).toBe(0);
    // 가용 7버킷 가중치 합 = 1.0
    expect(sum(effectiveWeights)).toBeCloseTo(1.0, 10);
    // 기존 7버킷의 레거시 가중치(0.25/0.20/0.15/0.10/0.15/0.10/0.05)를 정확히 복원
    const LEGACY: Record<string, number> = {
      disclosureEvent: 0.25,
      keyMetric: 0.2,
      personaFit: 0.15,
      historicalEvent: 0.1,
      chart: 0.15,
      volumeLiquidity: 0.1,
      marketSector: 0.05,
    };
    for (const k of Object.keys(LEGACY)) {
      expect(effectiveWeights[k as BucketKey]).toBeCloseTo(LEGACY[k], 10);
    }
  });

  it('★DAR-100 회귀 0: fundamental 결측(only) → 기존 8버킷(DAR-88) 가중치를 정확히 복원', () => {
    // fundamental 데이터만 미적재(insider 는 가용) 종목 재현.
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(
      W,
      availabilityOf({ fundamental: false }),
    );
    expect(omittedBuckets).toEqual(['fundamental']);
    expect(effectiveWeights.fundamental).toBe(0);
    // 가용 8버킷 가중치 합 = 1.0
    expect(sum(effectiveWeights)).toBeCloseTo(1.0, 10);
    // DAR-88 8버킷 가중치(레거시×0.95, insider=0.05)를 정확히 복원
    const DAR88: Record<string, number> = {
      disclosureEvent: 0.25 * 0.95,
      keyMetric: 0.2 * 0.95,
      personaFit: 0.15 * 0.95,
      historicalEvent: 0.1 * 0.95,
      chart: 0.15 * 0.95,
      volumeLiquidity: 0.1 * 0.95,
      marketSector: 0.05 * 0.95,
      insider: 0.05,
    };
    for (const k of Object.keys(DAR88)) {
      expect(effectiveWeights[k as BucketKey]).toBeCloseTo(DAR88[k], 10);
    }
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
        insider: false,
        fundamental: false,
      }),
    );
    expect(omittedBuckets.length).toBe(8);
    expect(effectiveWeights.disclosureEvent).toBeCloseTo(1.0, 10);
    expect(sum(effectiveWeights)).toBeCloseTo(1.0, 10);
  });

  it('전부 결측 방어 → 모든 가중치 0, 합 0 (크래시·NaN 없음)', () => {
    const allFalse = ALL_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: false }),
      {} as BucketAvailability,
    );
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(W, allFalse);
    expect(omittedBuckets.length).toBe(ALL_KEYS.length);
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
    // DAR-321: keyMetric 가용 판정은 eventType 의 규칙 존재 여부로 결정.
    keyMetric: { eventType: 'SUPPLY_CONTRACT', extractedData: { salesRatio: 35 } },
    insider: {
      trades: [
        {
          source: 'EXECUTIVE' as const,
          tradeType: 'BUY' as const,
          ratioChange: 1.2,
          isMajorShareholder: true,
        },
      ],
    },
    fundamental: {
      growth: {
        revenueGrowthYoY: 20,
        operatingProfitGrowthYoY: 15,
        epsGrowthYoY: 10,
      },
      filedFacts: { contractToSalesRatio: 30, dilutionRate: null },
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
      insider: true,
      fundamental: true,
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

  it('DAR-88: 내부자 보고 0건 → insider 결측', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      insider: { trades: [] },
    });
    expect(a.insider).toBe(false);
  });

  it('DAR-88: 내부자 보고 1건이라도 존재 → insider 가용', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      insider: {
        trades: [
          {
            source: 'MAJOR_STOCK' as const,
            tradeType: 'SELL' as const,
            ratioChange: -0.5,
            isMajorShareholder: false,
          },
        ],
      },
    });
    expect(a.insider).toBe(true);
  });

  it('DAR-100: 성장률·본문 정량값 전무 → fundamental 결측', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      fundamental: { growth: null, filedFacts: null },
    });
    expect(a.fundamental).toBe(false);
  });

  it('DAR-100: 성장률 전필드 null + 정량값 전필드 null → fundamental 결측', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      fundamental: {
        growth: {
          revenueGrowthYoY: null,
          operatingProfitGrowthYoY: null,
          epsGrowthYoY: null,
        },
        filedFacts: { contractToSalesRatio: null, dilutionRate: null },
      },
    });
    expect(a.fundamental).toBe(false);
  });

  it('DAR-100: 성장률 1필드라도 존재 → fundamental 가용', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      fundamental: {
        growth: {
          revenueGrowthYoY: 12,
          operatingProfitGrowthYoY: null,
          epsGrowthYoY: null,
        },
        filedFacts: null,
      },
    });
    expect(a.fundamental).toBe(true);
  });

  it('DAR-100: 본문 정량값 1필드라도 존재 → fundamental 가용', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      fundamental: {
        growth: null,
        filedFacts: { contractToSalesRatio: null, dilutionRate: 8 },
      },
    });
    expect(a.fundamental).toBe(true);
  });

  // ─── DAR-321: 미모델 이벤트 keyMetric / UNKNOWN polarity personaFit omit ───

  it('DAR-321: keyMetric 규칙 있는 이벤트(중립/저점이어도) → keyMetric 가용 유지', () => {
    // 규칙은 있으나 값이 저점(salesRatio<1 → score 0)인 경우: "실제 평가" → 분모 유지.
    const a = detectBucketAvailability({
      ...fullInput,
      keyMetric: { eventType: 'SUPPLY_CONTRACT', extractedData: { salesRatio: 0.5 } },
    });
    expect(a.keyMetric).toBe(true);
  });

  it('DAR-321: keyMetric 규칙 없는 미모델 이벤트(default→0) → keyMetric 결측(omit)', () => {
    // DAR-322 이후에도 여전히 규칙 없는 타입(OTHER·BW_ISSUANCE·EARNINGS_SHOCK)은 default→0("미채점").
    for (const eventType of ['OTHER', 'BW_ISSUANCE', 'EARNINGS_SHOCK']) {
      const a = detectBucketAvailability({
        ...fullInput,
        keyMetric: { eventType, extractedData: {} },
      });
      expect(a.keyMetric).toBe(false);
    }
  });

  it('DAR-322: omit→실평가 승격된 3종(SHARE_BUYBACK·THIRD_PARTY_ALLOTMENT·MAJOR_SHAREHOLDER_CHANGE)은 keyMetric 가용', () => {
    // 규칙이 생겼으므로 extractedData 가 비어도(저점 0) "실제 평가" → 분모 유지(omit 아님).
    for (const eventType of ['SHARE_BUYBACK', 'THIRD_PARTY_ALLOTMENT', 'MAJOR_SHAREHOLDER_CHANGE']) {
      const a = detectBucketAvailability({
        ...fullInput,
        keyMetric: { eventType, extractedData: {} },
      });
      expect(a.keyMetric).toBe(true);
    }
  });

  it('DAR-321: UNKNOWN polarity → 전 persona NEUTRAL → personaFit 결측(omit)', () => {
    // persona-view.rule 은 polarity UNKNOWN 시 4 persona 전부 NEUTRAL 을 부여(정보 없음).
    const a = detectBucketAvailability({
      ...fullInput,
      personaFit: {
        personaViews: [
          { persona: 'GROWTH', view: 'NEUTRAL' },
          { persona: 'VALUE', view: 'NEUTRAL' },
          { persona: 'MOMENTUM', view: 'NEUTRAL' },
          { persona: 'EVENT_DRIVEN', view: 'NEUTRAL' },
        ],
        userPersona: 'GROWTH',
      },
    });
    expect(a.personaFit).toBe(false);
  });

  it('DAR-321: 사용자 persona 만 NEUTRAL·타 persona 비중립 → 실제 중립 판정 → personaFit 가용 유지', () => {
    const a = detectBucketAvailability({
      ...fullInput,
      personaFit: {
        personaViews: [
          { persona: 'GROWTH', view: 'NEUTRAL' },
          { persona: 'VALUE', view: 'POSITIVE' },
        ],
        userPersona: 'GROWTH',
      },
    });
    expect(a.personaFit).toBe(true);
  });
});
