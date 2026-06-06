import { BuySignalService, BuyScoreParams } from './buy-signal.service';
import { scoreChart, ChartInput } from './scoring/chart.scorer';
import {
  evaluateEntryConditions,
  EntryConditionInput,
} from './entry/entry-condition.evaluator';

/**
 * DAR-50: 기술지표(TI) 백필이 chart 점수·entryReady 를 해금하여
 * 모의매수 경로(entryReady)·BUY 등급 출현을 가능케 함을 결정론적으로 증명.
 */
describe('TI 백필 → chart/entryReady 해금 (DAR-50)', () => {
  const service = new BuySignalService();

  const bullishChart: ChartInput = {
    closePrice: 12000,
    ma5: 11800,
    ma20: 10000,
    ma60: 9000,
    rsi14: 55,
    macdLine: 50,
    macdSignal: 20,
    bollingerMid: 10500,
    preDsclReturn: 2,
  };

  const bullishEntry: EntryConditionInput = {
    closePrice: 12000,
    ma20: 10000,
    rsi14: 55,
    tradingValue: 5_000_000_000,
    volumeRatio20: 1.5,
  };

  // TI 부재 상태 (백필 전): 지표 전부 null
  const emptyEntry: EntryConditionInput = {
    closePrice: 12000,
    ma20: null,
    rsi14: null,
    tradingValue: 5_000_000_000,
    volumeRatio20: null,
  };

  it('순수함수: TI 부재 시 entryReady=false (ABOVE_MA20 영구 false 재현)', () => {
    expect(evaluateEntryConditions(emptyEntry).entryReady).toBe(false);
  });

  it('순수함수: TI 적재(bullish) 시 entryReady=true (ABOVE_MA20 해금)', () => {
    const r = evaluateEntryConditions(bullishEntry);
    expect(r.entryReady).toBe(true);
    expect(r.met).toContain('현재가가 20일 이동평균선 위');
  });

  it('순수함수: TI 부재 시 chart 점수=0, 적재 시 chart 점수>0', () => {
    const emptyChart: ChartInput = {
      closePrice: 12000,
      ma5: null,
      ma20: null,
      ma60: null,
      rsi14: null,
      macdLine: null,
      macdSignal: null,
      bollingerMid: null,
      preDsclReturn: null,
    };
    expect(scoreChart(emptyChart)).toBe(0);
    expect(scoreChart(bullishChart)).toBeGreaterThan(0);
  });

  function baseParams(chart: ChartInput, entry: EntryConditionInput): BuyScoreParams {
    return {
      rcpNo: 'U1',
      corpCode: '00100000',
      stockCode: '000100',
      persona: 'EVENT_DRIVEN',
      disclosureEvent: { eventType: 'SHARE_CANCELLATION', polarity: 'POSITIVE' },
      keyMetric: {
        eventType: 'SHARE_CANCELLATION',
        extractedData: { cancellationRatio: 6 },
      },
      personaFitInput: {
        personaViews: [{ persona: 'EVENT_DRIVEN', view: 'POSITIVE' }],
        userPersona: 'EVENT_DRIVEN',
      },
      historicalEvent: { avgArD5: 3 },
      chart,
      volumeLiquidity: {
        volume: 500000,
        avgVolume20: 200000,
        tradingValue: 5_000_000_000,
        avgValue20: 3_000_000_000,
      },
      marketSector: {
        kospiChange1d: 1.5,
        kosdaqChange1d: 1.0,
        sectorChange1d: null,
        vixEquivalent: null,
      },
      riskPenalty: {
        eventType: 'SHARE_CANCELLATION',
        isAmendment: false,
        preDsclReturn: entry === bullishEntry ? 2 : null,
        isTradingSuspended: false,
        isManagement: false,
        isInvestmentCaution: false,
        isAbnormalSurge: false,
        dilutionRate: null,
        avgDailyVolume: 200000,
      },
      entryCondition: entry,
    };
  }

  it('강한 호재 + bullish TI → BUY 등급 출현 + entryReady=true (모의매수 작동 조건)', () => {
    const result = service.computeBuyScore(baseParams(bullishChart, bullishEntry));
    expect(['BUY_CANDIDATE', 'STRONG_BUY_CANDIDATE']).toContain(result.signal);
    expect(result.buyScore).toBeGreaterThanOrEqual(60);
    expect(result.entryReady).toBe(true);
    expect(result.scoreBreakdown.chart).toBeGreaterThan(0);
  });
});
