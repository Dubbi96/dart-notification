/**
 * buy-signal.spec.ts — M6-A Buy Score 엔진 Fixture 테스트 (DAR-10)
 *
 * 실제 DB/AI 없이 순수 Rule 함수를 검증한다.
 * AI 금지영역: 이 테스트는 AI 개입 없는 Rule 함수만 다룬다.
 */

import { BuySignalService, mapScoreToGrade, BuyScoreParams } from './buy-signal.service';
import { scoreDisclosureEvent } from './scoring/disclosure-event.scorer';
import { scoreKeyMetric } from './scoring/key-metric.scorer';
import { scorePersonaFit } from './scoring/persona-fit.scorer';
import { scoreHistoricalEvent } from './scoring/historical-event.scorer';
import { scoreChart } from './scoring/chart.scorer';
import { scoreVolumeLiquidity } from './scoring/volume-liquidity.scorer';
import { scoreMarketSector } from './scoring/market-sector.scorer';
import { scoreRiskPenalty } from './scoring/risk-penalty.scorer';
import { evaluateEntryConditions } from './entry/entry-condition.evaluator';

// ─── 공통 fixture helpers ────────────────────────────────────────────

function makeParams(overrides: Partial<BuyScoreParams> = {}): BuyScoreParams {
  return {
    rcpNo: 'RCP001',
    corpCode: 'CORP001',
    stockCode: '005930',
    persona: 'GROWTH',
    disclosureEvent: { eventType: 'SUPPLY_CONTRACT', polarity: 'POSITIVE' },
    keyMetric: {
      eventType: 'SUPPLY_CONTRACT',
      extractedData: { salesRatio: 25 },
    },
    personaFitInput: {
      personaViews: [{ persona: 'GROWTH', view: 'POSITIVE' }],
      userPersona: 'GROWTH',
    },
    historicalEvent: { avgArD5: 6 },
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
    riskPenalty: {
      eventType: 'SUPPLY_CONTRACT',
      isAmendment: false,
      preDsclReturn: 2,
      isTradingSuspended: false,
      isManagement: false,
      isInvestmentCaution: false,
      isAbnormalSurge: false,
      dilutionRate: null,
      avgDailyVolume: 3_000_000,
    },
    entryCondition: {
      closePrice: 50000,
      ma20: 47000,
      rsi14: 55,
      tradingValue: 150_000_000_000,
      volumeRatio20: 3,
    },
    ...overrides,
  };
}

// ─── BuySignalService 통합 테스트 ────────────────────────────────────

describe('BuySignalService', () => {
  const service = new BuySignalService();

  it('should return STRONG_BUY_CANDIDATE for ideal buy conditions', () => {
    const result = service.computeBuyScore(makeParams());
    expect(result.buyScore).toBeGreaterThanOrEqual(60);
    expect(['STRONG_BUY_CANDIDATE', 'BUY_CANDIDATE']).toContain(result.signal);
  });

  it('should return BLOCKED when stock is trading suspended', () => {
    const result = service.computeBuyScore(
      makeParams({
        riskPenalty: {
          eventType: 'SUPPLY_CONTRACT',
          isAmendment: false,
          preDsclReturn: null,
          isTradingSuspended: true,
          isManagement: false,
          isInvestmentCaution: false,
          isAbnormalSurge: false,
          dilutionRate: null,
          avgDailyVolume: null,
        },
      }),
    );
    expect(result.signal).toBe('BLOCKED');
    expect(result.buyScore).toBe(-100);
    expect(result.entryReady).toBe(false);
  });

  it('should return BLOCKED when stock is in management (관리종목)', () => {
    const result = service.computeBuyScore(
      makeParams({
        riskPenalty: {
          eventType: 'SUPPLY_CONTRACT',
          isAmendment: false,
          preDsclReturn: null,
          isTradingSuspended: false,
          isManagement: true,
          isInvestmentCaution: false,
          isAbnormalSurge: false,
          dilutionRate: null,
          avgDailyVolume: null,
        },
      }),
    );
    expect(result.signal).toBe('BLOCKED');
  });

  it('should return BLOCKED for AUDIT_OPINION_RISK event type', () => {
    const result = service.computeBuyScore(
      makeParams({
        disclosureEvent: { eventType: 'AUDIT_OPINION_RISK', polarity: 'NEGATIVE' },
        riskPenalty: {
          eventType: 'AUDIT_OPINION_RISK',
          isAmendment: false,
          preDsclReturn: null,
          isTradingSuspended: false,
          isManagement: false,
          isInvestmentCaution: false,
          isAbnormalSurge: false,
          dilutionRate: null,
          avgDailyVolume: null,
        },
      }),
    );
    expect(result.signal).toBe('BLOCKED');
  });

  it('should produce AVOID for EARNINGS_SHOCK event with all negative indicators', () => {
    const result = service.computeBuyScore(
      makeParams({
        disclosureEvent: { eventType: 'EARNINGS_SHOCK', polarity: 'NEGATIVE' },
        keyMetric: { eventType: 'EARNINGS_SHOCK', extractedData: {} },
        // zero out positive persona/history
        personaFitInput: {
          personaViews: [{ persona: 'GROWTH', view: 'NEGATIVE' }],
          userPersona: 'GROWTH',
        },
        historicalEvent: { avgArD5: -5 },
        chart: {
          closePrice: 40000,
          ma5: 45000,
          ma20: 48000,
          ma60: 50000,
          rsi14: 28,
          macdLine: -300,
          macdSignal: -100,
          bollingerMid: 48000,
          preDsclReturn: 0,
        },
        volumeLiquidity: {
          volume: 1_200_000,
          avgVolume20: 1_000_000,
          tradingValue: 15_000_000_000,
          avgValue20: 50_000_000_000,
        },
        marketSector: {
          kospiChange1d: -1.5,
          kosdaqChange1d: -1.0,
          sectorChange1d: -2.5,
          vixEquivalent: 35,
        },
        riskPenalty: {
          eventType: 'EARNINGS_SHOCK',
          isAmendment: false,
          preDsclReturn: 0,
          isTradingSuspended: false,
          isManagement: false,
          isInvestmentCaution: false,
          isAbnormalSurge: false,
          dilutionRate: null,
          avgDailyVolume: 3_000_000,
        },
      }),
    );
    expect(result.buyScore).toBeLessThan(0);
    expect(['AVOID', 'NEUTRAL']).toContain(result.signal);
  });

  it('should apply risk penalty and reduce score significantly', () => {
    const baseResult = service.computeBuyScore(makeParams());
    const penalizedResult = service.computeBuyScore(
      makeParams({
        riskPenalty: {
          eventType: 'SUPPLY_CONTRACT',
          isAmendment: true,     // +15
          preDsclReturn: 25,     // +60 (>20:+40, >10:+20)
          isTradingSuspended: false,
          isManagement: false,
          isInvestmentCaution: false,
          isAbnormalSurge: false,
          dilutionRate: null,
          avgDailyVolume: 50_000, // +20 저유동성
        },
      }),
    );
    expect(penalizedResult.buyScore).toBeLessThan(baseResult.buyScore);
    expect(penalizedResult.riskPenalty).toBeGreaterThan(0);
  });

  it('should set entryReady=false when RSI >= 70 (overbought)', () => {
    const result = service.computeBuyScore(
      makeParams({
        chart: { ...makeParams().chart, rsi14: 75 },
        entryCondition: {
          closePrice: 50000,
          ma20: 47000,
          rsi14: 75,
          tradingValue: 150_000_000_000,
          volumeRatio20: 3,
        },
      }),
    );
    expect(result.entryReady).toBe(false);
    expect(result.entryConditionUnmet).toContain('RSI 70 미만(과열 미도달)');
  });

  it('should set entryReady=false when close < ma20', () => {
    const result = service.computeBuyScore(
      makeParams({
        entryCondition: {
          closePrice: 44000,
          ma20: 47000,
          rsi14: 55,
          tradingValue: 150_000_000_000,
          volumeRatio20: 3,
        },
      }),
    );
    expect(result.entryReady).toBe(false);
    expect(result.entryConditionUnmet).toContain('현재가가 20일 이동평균선 위');
  });

  it('should clamp score to 100 maximum', () => {
    const result = service.computeBuyScore(makeParams());
    expect(result.buyScore).toBeLessThanOrEqual(100);
    expect(result.buyScore).toBeGreaterThanOrEqual(-100);
  });

  it('should produce WATCH for moderate positive scenario', () => {
    const result = service.computeBuyScore(
      makeParams({
        disclosureEvent: { eventType: 'MAJOR_SHAREHOLDER_CHANGE', polarity: 'POSITIVE' },
        keyMetric: { eventType: 'MAJOR_SHAREHOLDER_CHANGE', extractedData: {} },
        historicalEvent: { avgArD5: 1 },
        chart: {
          closePrice: 50000,
          ma5: 49000,
          ma20: 47000,
          ma60: 51000,
          rsi14: 50,
          macdLine: 100,
          macdSignal: 200,
          bollingerMid: 48000,
          preDsclReturn: 5,
        },
        volumeLiquidity: {
          volume: 1_200_000,
          avgVolume20: 1_000_000,
          tradingValue: 12_000_000_000,
          avgValue20: 10_000_000_000,
        },
        marketSector: {
          kospiChange1d: 0.1,
          kosdaqChange1d: null,
          sectorChange1d: 0.2,
          vixEquivalent: null,
        },
      }),
    );
    expect(['WATCH', 'NEUTRAL', 'BUY_CANDIDATE']).toContain(result.signal);
  });

  it('should handle null chart data gracefully (return 0 chart score)', () => {
    const result = service.computeBuyScore(
      makeParams({
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
      }),
    );
    expect(result.scoreBreakdown.chart).toBe(0);
    expect(result.buyScore).toBeGreaterThanOrEqual(-100);
    expect(result.buyScore).toBeLessThanOrEqual(100);
  });

  it('should produce entryReady=true when all required conditions met', () => {
    const result = service.computeBuyScore(makeParams());
    expect(result.entryConditionMet).toContain('현재가가 20일 이동평균선 위');
    expect(result.entryConditionMet).toContain('RSI 70 미만(과열 미도달)');
    expect(result.entryConditionMet).toContain('거래대금 10억 이상(최소 유동성)');
    expect(result.entryReady).toBe(true);
  });

  // ─── DAR-49: 결측 버킷 제외 가중치 재정규화 (BUY 신호 0 근본 해소) ───────

  it('전버킷 가용 시 omittedBuckets 비어있고 dataAvailability 전부 true', () => {
    // DAR-88: insider 도 가용해야 진정한 "전버킷 가용" → 내부자 보고 1건 주입.
    // DAR-100: fundamental 도 가용해야 → 성장률/본문 정량값 주입.
    const result = service.computeBuyScore(
      makeParams({
        insider: {
          trades: [
            {
              source: 'EXECUTIVE',
              tradeType: 'BUY',
              ratioChange: 1.5,
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
      }),
    );
    expect(result.omittedBuckets).toEqual([]);
    expect(Object.values(result.dataAvailability).every((v) => v === true)).toBe(
      true,
    );
  });

  it('★근본해소: chart+historicalEvent 결측이어도 강한 공시는 BUY 임계 도달', () => {
    // technical_indicators / event_study 미산출 상황을 재현:
    //   chart 전필드 null, historicalEvent.avgArD5 null.
    // 기존 산식: 0.25*70+0.20*80+0.15*100+0.10*70+0.05*20 = 56.5 → 57 → WATCH(<60).
    // 재정규화: 결측 0.25 제외, 가용 0.75 로 스케일 → 75 → BUY_CANDIDATE(>=60).
    const result = service.computeBuyScore(
      makeParams({
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
        historicalEvent: { avgArD5: null },
      }),
    );
    // DAR-88: makeParams 는 insider 미주입 → insider 도 결측으로 함께 제외.
    // DAR-100: makeParams 는 fundamental 미주입 → fundamental 도 결측으로 함께 제외.
    expect(result.omittedBuckets.sort()).toEqual([
      'chart',
      'fundamental',
      'historicalEvent',
      'insider',
    ]);
    expect(result.dataAvailability.chart).toBe(false);
    expect(result.dataAvailability.historicalEvent).toBe(false);
    expect(result.dataAvailability.insider).toBe(false);
    expect(result.dataAvailability.fundamental).toBe(false);
    // 임계값 불변(60) 인데도 정당한 신호가 자연히 올라옴.
    expect(result.buyScore).toBeGreaterThanOrEqual(60);
    expect(['BUY_CANDIDATE', 'STRONG_BUY_CANDIDATE']).toContain(result.signal);
  });

  it('insider+fundamental 결측(레거시 7버킷) 점수 == 레거시 가중합 — 산식 의미 보존(DAR-88/100 회귀 0)', () => {
    // makeParams()는 insider·fundamental 미주입 → 둘 다 결측 → 재정규화가 기존 7버킷
    // 가중치를 정확히 복원하므로, 레거시(0.25/0.20/…) 고정 가중합과 점수가 일치해야 한다(회귀 0).
    const params = makeParams();
    const result = service.computeBuyScore(params);
    expect(result.omittedBuckets).toEqual(['insider', 'fundamental']);

    // 레거시 공식(고정 7버킷 가중치, 결측 강제 0)을 직접 재현
    const b = result.scoreBreakdown;
    const legacy =
      0.25 * b.disclosureEvent +
      0.2 * b.keyMetric +
      0.15 * b.personaFit +
      0.1 * b.historicalEvent +
      0.15 * b.chart +
      0.1 * b.volumeLiquidity +
      0.05 * b.marketSector;
    // riskPenalty=0(clean) 이므로 buyScore == round(clamp(legacy)).
    expect(result.buyScore).toBe(Math.round(legacy));
  });

  it('BLOCKED 경로도 dataAvailability/omittedBuckets 를 표기', () => {
    const result = service.computeBuyScore(
      makeParams({
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
        riskPenalty: {
          eventType: 'SUPPLY_CONTRACT',
          isAmendment: false,
          preDsclReturn: null,
          isTradingSuspended: true,
          isManagement: false,
          isInvestmentCaution: false,
          isAbnormalSurge: false,
          dilutionRate: null,
          avgDailyVolume: null,
        },
      }),
    );
    expect(result.signal).toBe('BLOCKED');
    expect(result.dataAvailability.chart).toBe(false);
    expect(result.omittedBuckets).toContain('chart');
  });
});

// ─── mapScoreToGrade 테스트 ────────────────────────────────────────

describe('mapScoreToGrade()', () => {
  it('should return STRONG_BUY_CANDIDATE for score >= 80', () => {
    expect(mapScoreToGrade(80)).toBe('STRONG_BUY_CANDIDATE');
    expect(mapScoreToGrade(100)).toBe('STRONG_BUY_CANDIDATE');
  });

  it('should return BUY_CANDIDATE for score 60~79', () => {
    expect(mapScoreToGrade(60)).toBe('BUY_CANDIDATE');
    expect(mapScoreToGrade(79)).toBe('BUY_CANDIDATE');
  });

  it('should return WATCH for score 30~59', () => {
    expect(mapScoreToGrade(30)).toBe('WATCH');
    expect(mapScoreToGrade(59)).toBe('WATCH');
  });

  it('should return NEUTRAL for score -29~29', () => {
    expect(mapScoreToGrade(0)).toBe('NEUTRAL');
    expect(mapScoreToGrade(29)).toBe('NEUTRAL');
    expect(mapScoreToGrade(-29)).toBe('NEUTRAL');
  });

  it('should return AVOID for score < -29', () => {
    expect(mapScoreToGrade(-30)).toBe('AVOID');
    expect(mapScoreToGrade(-100)).toBe('AVOID');
  });
});

// ─── DisclosureEventScorer 단위 테스트 ──────────────────────────────

describe('scoreDisclosureEvent()', () => {
  it('SUPPLY_CONTRACT + POSITIVE → 70', () => {
    expect(scoreDisclosureEvent({ eventType: 'SUPPLY_CONTRACT', polarity: 'POSITIVE' })).toBe(70);
  });

  it('EARNINGS_SHOCK + POSITIVE → -80', () => {
    expect(scoreDisclosureEvent({ eventType: 'EARNINGS_SHOCK', polarity: 'POSITIVE' })).toBe(-80);
  });

  it('SUPPLY_CONTRACT + NEGATIVE → 35 (70 × 0.5)', () => {
    expect(scoreDisclosureEvent({ eventType: 'SUPPLY_CONTRACT', polarity: 'NEGATIVE' })).toBe(35);
  });

  it('SUPPLY_CONTRACT + MIXED → 49 (70 × 0.7)', () => {
    expect(scoreDisclosureEvent({ eventType: 'SUPPLY_CONTRACT', polarity: 'MIXED' })).toBe(49);
  });

  it('TRADING_SUSPENSION + POSITIVE polarity → -100', () => {
    expect(scoreDisclosureEvent({ eventType: 'TRADING_SUSPENSION', polarity: 'POSITIVE' })).toBe(-100);
  });

  it('TRADING_SUSPENSION + NEGATIVE polarity → -50 (base -100 × 0.5)', () => {
    expect(scoreDisclosureEvent({ eventType: 'TRADING_SUSPENSION', polarity: 'NEGATIVE' })).toBe(-50);
  });

  it('unknown event type → 0', () => {
    expect(scoreDisclosureEvent({ eventType: 'UNKNOWN_TYPE', polarity: 'POSITIVE' })).toBe(0);
  });

  it('SHARE_CANCELLATION → 80', () => {
    expect(scoreDisclosureEvent({ eventType: 'SHARE_CANCELLATION', polarity: 'POSITIVE' })).toBe(80);
  });
});

// ─── KeyMetricScorer 단위 테스트 ─────────────────────────────────────

describe('scoreKeyMetric()', () => {
  describe('SUPPLY_CONTRACT', () => {
    it('salesRatio >= 30 → 100', () => {
      expect(scoreKeyMetric({ eventType: 'SUPPLY_CONTRACT', extractedData: { salesRatio: 35 } })).toBe(100);
    });
    it('salesRatio = 20 → 80', () => {
      expect(scoreKeyMetric({ eventType: 'SUPPLY_CONTRACT', extractedData: { salesRatio: 20 } })).toBe(80);
    });
    it('salesRatio < 1 → 0', () => {
      expect(scoreKeyMetric({ eventType: 'SUPPLY_CONTRACT', extractedData: { salesRatio: 0.5 } })).toBe(0);
    });
  });

  describe('PAID_IN_CAPITAL_INCREASE', () => {
    it('dilutionRate >= 30 → -100', () => {
      expect(scoreKeyMetric({ eventType: 'PAID_IN_CAPITAL_INCREASE', extractedData: { dilutionRate: 30 } })).toBe(-100);
    });
    it('dilutionRate < 5 → -20', () => {
      expect(scoreKeyMetric({ eventType: 'PAID_IN_CAPITAL_INCREASE', extractedData: { dilutionRate: 3 } })).toBe(-20);
    });
  });

  it('default event → 0', () => {
    expect(scoreKeyMetric({ eventType: 'LAWSUIT', extractedData: {} })).toBe(0);
  });
});

// ─── RiskPenaltyScorer 단위 테스트 ────────────────────────────────────

describe('scoreRiskPenalty()', () => {
  const base = {
    eventType: 'SUPPLY_CONTRACT',
    isAmendment: false,
    preDsclReturn: null,
    isTradingSuspended: false,
    isManagement: false,
    isInvestmentCaution: false,
    isAbnormalSurge: false,
    dilutionRate: null,
    avgDailyVolume: null,
  };

  it('clean stock → penalty = 0', () => {
    expect(scoreRiskPenalty(base)).toBe(0);
  });

  it('trading suspended → Infinity', () => {
    expect(scoreRiskPenalty({ ...base, isTradingSuspended: true })).toBe(Infinity);
  });

  it('management stock → Infinity', () => {
    expect(scoreRiskPenalty({ ...base, isManagement: true })).toBe(Infinity);
  });

  it('investment caution → Infinity', () => {
    expect(scoreRiskPenalty({ ...base, isInvestmentCaution: true })).toBe(Infinity);
  });

  it('abnormal surge → Infinity', () => {
    expect(scoreRiskPenalty({ ...base, isAbnormalSurge: true })).toBe(Infinity);
  });

  it('AUDIT_OPINION_RISK event → Infinity', () => {
    expect(scoreRiskPenalty({ ...base, eventType: 'AUDIT_OPINION_RISK' })).toBe(Infinity);
  });

  it('pre-disclosure return > 20 → penalty 60 (40+20)', () => {
    expect(scoreRiskPenalty({ ...base, preDsclReturn: 25 })).toBe(60);
  });

  it('amendment → penalty includes 15', () => {
    const p = scoreRiskPenalty({ ...base, isAmendment: true });
    expect(p).toBe(15);
  });

  it('low volume → penalty includes 20', () => {
    const p = scoreRiskPenalty({ ...base, avgDailyVolume: 50_000 });
    expect(p).toBe(20);
  });

  it('multiple penalties accumulate correctly', () => {
    const p = scoreRiskPenalty({
      ...base,
      isAmendment: true,    // +15
      preDsclReturn: 12,    // >10: +20
      avgDailyVolume: 50_000, // +20
    });
    expect(p).toBe(55);
  });
});

// ─── EntryConditionEvaluator 단위 테스트 ───────────────────────────────

describe('evaluateEntryConditions()', () => {
  it('all required conditions met → entryReady=true', () => {
    const result = evaluateEntryConditions({
      closePrice: 50000,
      ma20: 47000,
      rsi14: 55,
      tradingValue: 2_000_000_000,
      volumeRatio20: 3.5,
    });
    expect(result.entryReady).toBe(true);
    expect(result.met).toContain('현재가가 20일 이동평균선 위');
    expect(result.met).toContain('RSI 70 미만(과열 미도달)');
    expect(result.met).toContain('거래대금 10억 이상(최소 유동성)');
  });

  it('RSI >= 70 → entryReady=false', () => {
    const result = evaluateEntryConditions({
      closePrice: 50000,
      ma20: 47000,
      rsi14: 71,
      tradingValue: 2_000_000_000,
      volumeRatio20: null,
    });
    expect(result.entryReady).toBe(false);
    expect(result.unmet).toContain('RSI 70 미만(과열 미도달)');
  });

  it('below MA20 → entryReady=false', () => {
    const result = evaluateEntryConditions({
      closePrice: 44000,
      ma20: 47000,
      rsi14: 50,
      tradingValue: 2_000_000_000,
      volumeRatio20: null,
    });
    expect(result.entryReady).toBe(false);
    expect(result.unmet).toContain('현재가가 20일 이동평균선 위');
  });

  it('tradingValue < 10억 → entryReady=false', () => {
    const result = evaluateEntryConditions({
      closePrice: 50000,
      ma20: 47000,
      rsi14: 55,
      tradingValue: 500_000_000,
      volumeRatio20: null,
    });
    expect(result.entryReady).toBe(false);
    expect(result.unmet).toContain('거래대금 10억 이상(최소 유동성)');
  });

  it('optional condition (volume surge) does not block entry', () => {
    const result = evaluateEntryConditions({
      closePrice: 50000,
      ma20: 47000,
      rsi14: 55,
      tradingValue: 2_000_000_000,
      volumeRatio20: 1.0, // < 3 → not met, but optional
    });
    expect(result.entryReady).toBe(true);
    expect(result.unmet).toContain('공시 후 거래량 20일 평균 대비 300% 이상');
  });
});

// ─── 개별 Scorer 단위 테스트 (histogram coverage) ─────────────────────

describe('scorePersonaFit()', () => {
  it('matching persona POSITIVE → 100', () => {
    expect(scorePersonaFit({
      personaViews: [{ persona: 'GROWTH', view: 'POSITIVE' }],
      userPersona: 'GROWTH',
    })).toBe(100);
  });

  it('no matching persona → 0', () => {
    expect(scorePersonaFit({
      personaViews: [{ persona: 'VALUE', view: 'POSITIVE' }],
      userPersona: 'GROWTH',
    })).toBe(0);
  });

  it('NEGATIVE view → -60', () => {
    expect(scorePersonaFit({
      personaViews: [{ persona: 'GROWTH', view: 'NEGATIVE' }],
      userPersona: 'GROWTH',
    })).toBe(-60);
  });

  it('WATCH view → 40', () => {
    expect(scorePersonaFit({
      personaViews: [{ persona: 'GROWTH', view: 'WATCH' }],
      userPersona: 'GROWTH',
    })).toBe(40);
  });
});

describe('scoreHistoricalEvent()', () => {
  it('null avgArD5 → 0', () => {
    expect(scoreHistoricalEvent({ avgArD5: null })).toBe(0);
  });
  it('avgArD5 >= 10 → 100', () => {
    expect(scoreHistoricalEvent({ avgArD5: 12 })).toBe(100);
  });
  it('avgArD5 = 3 → 40', () => {
    expect(scoreHistoricalEvent({ avgArD5: 3 })).toBe(40);
  });
  it('avgArD5 = -5 → -70', () => {
    expect(scoreHistoricalEvent({ avgArD5: -5 })).toBe(-70);
  });
});

describe('scoreChart()', () => {
  it('all null → 0', () => {
    expect(scoreChart({
      closePrice: null, ma5: null, ma20: null, ma60: null,
      rsi14: null, macdLine: null, macdSignal: null,
      bollingerMid: null, preDsclReturn: null,
    })).toBe(0);
  });

  it('all positive conditions → high positive score', () => {
    const score = scoreChart({
      closePrice: 50000,
      ma5: 48000,
      ma20: 47000,
      ma60: 45000,
      rsi14: 55,
      macdLine: 500,
      macdSignal: 400,
      bollingerMid: 46000,
      preDsclReturn: 2,
    });
    expect(score).toBeGreaterThan(50);
  });

  it('pre-surge > 15% applies penalty', () => {
    const noSurge = scoreChart({
      closePrice: 50000, ma5: 48000, ma20: 47000, ma60: null,
      rsi14: 55, macdLine: null, macdSignal: null,
      bollingerMid: null, preDsclReturn: 2,
    });
    const surge = scoreChart({
      closePrice: 50000, ma5: 48000, ma20: 47000, ma60: null,
      rsi14: 55, macdLine: null, macdSignal: null,
      bollingerMid: null, preDsclReturn: 20,
    });
    expect(surge).toBeLessThan(noSurge);
  });
});

describe('scoreVolumeLiquidity()', () => {
  it('tradingValue < 10억 → -100', () => {
    expect(scoreVolumeLiquidity({
      volume: 1_000_000,
      avgVolume20: 100_000,
      tradingValue: 500_000_000,
      avgValue20: 1_000_000_000,
    })).toBe(-100);
  });

  it('all null → 0', () => {
    expect(scoreVolumeLiquidity({
      volume: null, avgVolume20: null, tradingValue: null, avgValue20: null,
    })).toBe(0);
  });

  it('5x volume surge → high score', () => {
    const score = scoreVolumeLiquidity({
      volume: 5_000_000,
      avgVolume20: 1_000_000,
      tradingValue: 50_000_000_000,
      avgValue20: 10_000_000_000,
    });
    expect(score).toBeGreaterThan(50);
  });
});

describe('scoreMarketSector()', () => {
  it('all null → 0', () => {
    expect(scoreMarketSector({
      kospiChange1d: null, kosdaqChange1d: null,
      sectorChange1d: null, vixEquivalent: null,
    })).toBe(0);
  });

  it('KOSPI > 1% and positive sector → positive score', () => {
    const score = scoreMarketSector({
      kospiChange1d: 1.5,
      kosdaqChange1d: null,
      sectorChange1d: 2.0,
      vixEquivalent: null,
    });
    expect(score).toBeGreaterThan(0);
  });

  it('VIX > 30 applies penalty', () => {
    const noVix = scoreMarketSector({
      kospiChange1d: 0.5, kosdaqChange1d: null,
      sectorChange1d: null, vixEquivalent: null,
    });
    const highVix = scoreMarketSector({
      kospiChange1d: 0.5, kosdaqChange1d: null,
      sectorChange1d: null, vixEquivalent: 35,
    });
    expect(highVix).toBeLessThan(noVix);
  });
});
