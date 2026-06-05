/**
 * event-study.spec.ts — M5-A Event Study 엔진 Fixture 테스트 (DAR-9)
 *
 * 실제 DB/API 없이 순수 수학 함수와 집계 로직을 검증한다.
 */

import { mean, stdDev, tStatistic, tDistPValue, variance } from './utils/statistics';
import { calcD0, isKRXTradingDay, nextTradingDay } from './utils/d0-calculator';
import { classifyBucket } from './utils/bucket-classifier';
import { calcAR, calcDailyReturn, PriceWindow } from './utils/abnormal-return';
import { EventStudyService, MIN_SAMPLE_SIZE, EventObservationInput } from './event-study.service';

// ─────────────────────────────────────────────────────────────────
// 1. statistics.ts
// ─────────────────────────────────────────────────────────────────

describe('statistics.ts', () => {
  describe('mean()', () => {
    it('should compute arithmetic mean correctly', () => {
      expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3, 5);
    });

    it('should return 0 for empty array', () => {
      expect(mean([])).toBe(0);
    });

    it('should handle single element', () => {
      expect(mean([42])).toBe(42);
    });
  });

  describe('stdDev()', () => {
    it('should compute sample std dev — known σ=2 dataset', () => {
      // [2,4,4,4,5,5,7,9] population stddev=2, sample stddev ≈ 2.138
      const result = stdDev([2, 4, 4, 4, 5, 5, 7, 9]);
      // sample stddev (ddof=1)
      expect(result).toBeCloseTo(2.138, 2);
    });

    it('should return 0 for single element', () => {
      expect(stdDev([5])).toBe(0);
    });

    it('should return 0 for all same values', () => {
      expect(stdDev([3, 3, 3, 3])).toBe(0);
    });
  });

  describe('variance()', () => {
    it('should compute sample variance', () => {
      // 단순 검증: variance = stdDev^2
      const arr = [2, 4, 4, 4, 5, 5, 7, 9];
      const v = variance(arr);
      expect(v).toBeCloseTo(stdDev(arr) ** 2, 5);
    });
  });

  describe('tStatistic()', () => {
    it('should compute t-statistic correctly', () => {
      // arr=[5,5,5,5,5]: mean=5, stdDev=0 → t=Infinity
      expect(tStatistic([5, 5, 5, 5, 5])).toBe(Infinity);
    });

    it('should return positive t for positive mean', () => {
      const arr = [1, 2, 3, 4, 5]; // mean=3 > 0
      expect(tStatistic(arr)).toBeGreaterThan(0);
    });

    it('should compute correct t for known values', () => {
      // arr = [1,1,1]: mean=1, stdDev=0, t=Infinity
      expect(tStatistic([1, 1, 1])).toBe(Infinity);
    });

    it('should return 0 for n < 2', () => {
      expect(tStatistic([5])).toBe(0);
    });
  });

  describe('tDistPValue()', () => {
    it('should return p ≈ 0 for large |t|', () => {
      expect(tDistPValue(10, 30)).toBeCloseTo(0, 3);
    });

    it('should return p ≈ 1 for t ≈ 0', () => {
      expect(tDistPValue(0.001, 30)).toBeCloseTo(1, 1);
    });

    it('should return 0 for t = Infinity', () => {
      expect(tDistPValue(Infinity, 30)).toBe(0);
    });

    it('should return p < 0.05 for t ≥ 2', () => {
      expect(tDistPValue(2, 100)).toBeLessThan(0.05);
    });

    it('should return p > 0.05 for |t| < 1.96', () => {
      expect(tDistPValue(1.5, 100)).toBeGreaterThan(0.05);
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. d0-calculator.ts
// ─────────────────────────────────────────────────────────────────

describe('d0-calculator.ts', () => {
  describe('isKRXTradingDay()', () => {
    it('should return false for known holiday (신정 2025)', () => {
      expect(isKRXTradingDay('20250101')).toBe(false);
    });

    it('should return false for Saturday', () => {
      // 2025-01-04 is a Saturday
      expect(isKRXTradingDay('20250104')).toBe(false);
    });

    it('should return false for Sunday', () => {
      // 2025-01-05 is a Sunday
      expect(isKRXTradingDay('20250105')).toBe(false);
    });

    it('should return true for regular weekday (2025-01-02, Thursday)', () => {
      expect(isKRXTradingDay('20250102')).toBe(true);
    });

    it('should return false for 삼일절 (2025-03-01)', () => {
      expect(isKRXTradingDay('20250301')).toBe(false);
    });
  });

  describe('nextTradingDay()', () => {
    it('should skip weekend and return Monday for Friday input', () => {
      // 2025-01-03 (Friday) → next trading day = 2025-01-06 (Monday)
      expect(nextTradingDay('20250103')).toBe('20250106');
    });

    it('should skip holiday — 신정 2025-01-01 → 2025-01-02', () => {
      expect(nextTradingDay('20250101')).toBe('20250102');
    });

    it('should return next day for a regular weekday', () => {
      // 2025-01-02 (Thursday) → 2025-01-03 (Friday)
      expect(nextTradingDay('20250102')).toBe('20250103');
    });
  });

  describe('calcD0()', () => {
    it('should return same day when 14-char datetime ≤ 15:20 on trading day', () => {
      // 20250102 (Thursday) 14:00 → D0 = 20250102
      expect(calcD0('20250102140000')).toBe('20250102');
    });

    it('should return next trading day when 14-char datetime > 15:20', () => {
      // 20250102 (Thursday) 16:00 → D0 = 20250103 (Friday)
      expect(calcD0('20250102160000')).toBe('20250103');
    });

    it('should return next trading day for 8-char date (conservative)', () => {
      // 20250102 (date only, no time) → next trading day = 20250103
      expect(calcD0('20250102')).toBe('20250103');
    });

    it('should handle holiday date with 14-char → next trading day', () => {
      // 20250101 (신정, holiday) at 10:00 → next trading day = 20250102
      expect(calcD0('20250101100000')).toBe('20250102');
    });

    it('should return same day at exactly 15:20', () => {
      // 15:20 = cutoff (inclusive)
      expect(calcD0('20250102152000')).toBe('20250102');
    });

    it('should return next trading day at 15:21', () => {
      expect(calcD0('20250102152100')).toBe('20250103');
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. bucket-classifier.ts
// ─────────────────────────────────────────────────────────────────

describe('bucket-classifier.ts', () => {
  describe('SUPPLY_CONTRACT', () => {
    it('cancellation flag → SUPPLY_CONTRACT__cancellation', () => {
      expect(
        classifyBucket('SUPPLY_CONTRACT', {
          isCancellation: true,
          contractAmount: 1_000_000_000,
          recentSalesAmount: 4_000_000_000,
        }),
      ).toBe('SUPPLY_CONTRACT__cancellation');
    });

    it('amendment flag → SUPPLY_CONTRACT__amendment', () => {
      expect(
        classifyBucket('SUPPLY_CONTRACT', {
          isAmendment: true,
          contractAmount: 1_000_000_000,
          recentSalesAmount: 4_000_000_000,
        }),
      ).toBe('SUPPLY_CONTRACT__amendment');
    });

    it('ratio 25% → SUPPLY_CONTRACT__ratio_gte20', () => {
      expect(
        classifyBucket('SUPPLY_CONTRACT', {
          contractAmount: 2_500_000_000,
          recentSalesAmount: 10_000_000_000,
        }),
      ).toBe('SUPPLY_CONTRACT__ratio_gte20');
    });

    it('ratio 25% + isLargeCorp → SUPPLY_CONTRACT__ratio_gte20__large_corp', () => {
      expect(
        classifyBucket('SUPPLY_CONTRACT', {
          contractAmount: 2_500_000_000,
          recentSalesAmount: 10_000_000_000,
          isLargeCorp: true,
        }),
      ).toBe('SUPPLY_CONTRACT__ratio_gte20__large_corp');
    });

    it('ratio 10% (0.05~0.20) → SUPPLY_CONTRACT__ratio_5to20', () => {
      expect(
        classifyBucket('SUPPLY_CONTRACT', {
          contractAmount: 1_000_000_000,
          recentSalesAmount: 10_000_000_000,
        }),
      ).toBe('SUPPLY_CONTRACT__ratio_5to20');
    });

    it('ratio 3% < 5% → SUPPLY_CONTRACT__ratio_lt5', () => {
      expect(
        classifyBucket('SUPPLY_CONTRACT', {
          contractAmount: 300_000_000,
          recentSalesAmount: 10_000_000_000,
        }),
      ).toBe('SUPPLY_CONTRACT__ratio_lt5');
    });

    it('overseas flag without ratio → SUPPLY_CONTRACT__overseas', () => {
      expect(
        classifyBucket('SUPPLY_CONTRACT', {
          isOverseas: true,
        }),
      ).toBe('SUPPLY_CONTRACT__overseas');
    });

    it('no data → SUPPLY_CONTRACT__unknown', () => {
      expect(classifyBucket('SUPPLY_CONTRACT', {})).toBe('SUPPLY_CONTRACT__unknown');
    });
  });

  describe('SHARE_BUYBACK', () => {
    it('sharesRatio 2% → SHARE_BUYBACK__ratio_1to3', () => {
      expect(classifyBucket('SHARE_BUYBACK', { sharesRatio: 0.02 })).toBe(
        'SHARE_BUYBACK__ratio_1to3',
      );
    });

    it('sharesRatio 0.5% < 1% → SHARE_BUYBACK__ratio_lt1', () => {
      expect(classifyBucket('SHARE_BUYBACK', { sharesRatio: 0.005 })).toBe(
        'SHARE_BUYBACK__ratio_lt1',
      );
    });

    it('sharesRatio 5% ≥ 3% → SHARE_BUYBACK__ratio_gte3', () => {
      expect(classifyBucket('SHARE_BUYBACK', { sharesRatio: 0.05 })).toBe(
        'SHARE_BUYBACK__ratio_gte3',
      );
    });

    it('no sharesRatio → SHARE_BUYBACK__ratio_lt1 (default)', () => {
      expect(classifyBucket('SHARE_BUYBACK', {})).toBe('SHARE_BUYBACK__ratio_lt1');
    });
  });

  describe('SHARE_CANCELLATION', () => {
    it('→ SHARE_CANCELLATION__all', () => {
      expect(classifyBucket('SHARE_CANCELLATION', {})).toBe('SHARE_CANCELLATION__all');
    });
  });

  describe('PAID_IN_CAPITAL_INCREASE', () => {
    it('isRightsOffering → PAID_IN_CAPITAL__rights_offering', () => {
      expect(
        classifyBucket('PAID_IN_CAPITAL_INCREASE', { isRightsOffering: true }),
      ).toBe('PAID_IN_CAPITAL__rights_offering');
    });

    it('dilutionRatio 5% < 10% → PAID_IN_CAPITAL__third_party_lt10pct_dilution', () => {
      expect(
        classifyBucket('PAID_IN_CAPITAL_INCREASE', { dilutionRatio: 0.05 }),
      ).toBe('PAID_IN_CAPITAL__third_party_lt10pct_dilution');
    });

    it('dilutionRatio 15% ≥ 10% → PAID_IN_CAPITAL__third_party_gte10pct_dilution', () => {
      expect(
        classifyBucket('PAID_IN_CAPITAL_INCREASE', { dilutionRatio: 0.15 }),
      ).toBe('PAID_IN_CAPITAL__third_party_gte10pct_dilution');
    });
  });

  describe('CB_ISSUANCE', () => {
    it('amountRatio 3% < 5% → CB_ISSUANCE__ratio_lt5', () => {
      expect(classifyBucket('CB_ISSUANCE', { amountRatio: 0.03 })).toBe('CB_ISSUANCE__ratio_lt5');
    });

    it('amountRatio 10% ≥ 5% → CB_ISSUANCE__ratio_gte5', () => {
      expect(classifyBucket('CB_ISSUANCE', { amountRatio: 0.10 })).toBe('CB_ISSUANCE__ratio_gte5');
    });
  });

  describe('BW_ISSUANCE', () => {
    it('→ BW_ISSUANCE__all', () => {
      expect(classifyBucket('BW_ISSUANCE', {})).toBe('BW_ISSUANCE__all');
    });
  });

  describe('DIVIDEND_INCREASE', () => {
    it('25% yoy ≥ 20% → DIVIDEND_INCREASE__gte20pct_yoy', () => {
      expect(
        classifyBucket('DIVIDEND_INCREASE', { dividendChangeRatio: 0.25 }),
      ).toBe('DIVIDEND_INCREASE__gte20pct_yoy');
    });

    it('10% yoy < 20% → DIVIDEND_INCREASE__lt20pct_yoy', () => {
      expect(
        classifyBucket('DIVIDEND_INCREASE', { dividendChangeRatio: 0.10 }),
      ).toBe('DIVIDEND_INCREASE__lt20pct_yoy');
    });
  });

  describe('DIVIDEND_CUT', () => {
    it('→ DIVIDEND_CUT__all', () => {
      expect(classifyBucket('DIVIDEND_CUT', {})).toBe('DIVIDEND_CUT__all');
    });
  });

  describe('unknown eventType', () => {
    it('→ {eventType}__default', () => {
      expect(classifyBucket('UNKNOWN_EVENT', {})).toBe('UNKNOWN_EVENT__default');
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. abnormal-return.ts
// ─────────────────────────────────────────────────────────────────

/**
 * 테스트용 가격 시퀀스 생성 helper
 * D0를 기준으로 D-20~D+20 총 41일치 날짜를 순차 생성 (실제 거래일 무관, 단순 연속 날짜)
 *
 * stockPattern: 각 포지션별 종가 배열 (길이 41)
 * marketPattern: 각 포지션별 시장지수 배열 (길이 41)
 * D0는 인덱스 20 (0-based)
 */
function makePriceSequence(
  prices: number[],
  startDate = '20250103',
): PriceWindow[] {
  return prices.map((price, i) => {
    // 단순히 startDate에서 i일 더한 날짜 생성 (주말/공휴일 무시, 테스트용)
    const base = new Date(
      parseInt(startDate.slice(0, 4)),
      parseInt(startDate.slice(4, 6)) - 1,
      parseInt(startDate.slice(6, 8)),
    );
    base.setDate(base.getDate() + i);
    const y = base.getFullYear().toString();
    const mo = (base.getMonth() + 1).toString().padStart(2, '0');
    const d = base.getDate().toString().padStart(2, '0');
    return { date: `${y}${mo}${d}`, closePrice: price };
  });
}

describe('abnormal-return.ts', () => {
  describe('calcDailyReturn()', () => {
    it('should compute (to-from)/from*100', () => {
      expect(calcDailyReturn(100, 110)).toBeCloseTo(10, 5);
      expect(calcDailyReturn(100, 95)).toBeCloseTo(-5, 5);
      expect(calcDailyReturn(100, 100)).toBe(0);
    });

    it('should return 0 for from=0', () => {
      expect(calcDailyReturn(0, 100)).toBe(0);
    });
  });

  describe('calcAR()', () => {
    /**
     * Fixture:
     * - Stock: 100 for D-21~D-1 (prev), 100 at D0, 105 at D+1, 105 thereafter
     * - Market: 100 all 41 days (flat)
     * - D0 date: startDate + 20 (21st element, index 20)
     *
     * 총 41일: 인덱스 0~40, D0=인덱스 20
     * D0 수익률: prices[19]=100 → prices[20]=100 = 0%
     * D+1 수익률: prices[20]=100 → prices[21]=105 = 5%
     * Market D+1 = 0%
     * dailyAR['d1'] = 5 - 0 = 5
     * cumulativeAR['d1'] = 5
     */
    const startDate = '20250103'; // index=0
    // 41일 가격 배열: [100]*20 (D-20~D-1 전날) + [100] (D0) + [105]*20 (D+1~D+20)
    // 인덱스 0..19: D-21 전날 ~ D-1 전날 / 인덱스 20: D0 / 인덱스 21..40: D+1..D+20
    // 수익률 계산은 "현재 인덱스 - 1" 기준이므로:
    // D0 수익률: prices[19]→prices[20] = 100→100 = 0%
    // D+1 수익률: prices[20]→prices[21] = 100→105 = 5%
    const stockPrices41 = [
      ...Array(21).fill(100),  // 인덱스 0~20 (D-20 기준일 포함 D0)
      ...Array(20).fill(105),  // 인덱스 21~40 (D+1~D+20)
    ];
    const marketPrices41 = Array(41).fill(100); // 항상 flat

    const d0Date = '20250123'; // startDate + 20 days = 2025-01-23
    const stockPriceWindows = makePriceSequence(stockPrices41, startDate);
    const marketPriceWindows = makePriceSequence(marketPrices41, startDate);

    it('should produce d0 daily return = 0% (flat on D0)', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      expect(ar.dailyReturns['d0']).toBeCloseTo(0, 5);
    });

    it('should produce d1 daily return = 5% (jump on D+1)', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      expect(ar.dailyReturns['d1']).toBeCloseTo(5, 3);
    });

    it('should produce dailyAR[d1] = 5% (stock +5, market 0)', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      expect(ar.dailyAR['d1']).toBeCloseTo(5, 3);
    });

    it('should produce cumulativeAR[d1] = 5%', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      expect(ar.cumulativeAR['d1']).toBeCloseTo(5, 3);
    });

    it('should produce cumulativeAR[d5] = 5% (stock flat after D+1)', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      // d2~d5: stock flat, market flat → dailyAR=0 → cumulativeAR[d5]=5
      expect(ar.cumulativeAR['d5']).toBeCloseTo(5, 3);
    });

    it('should have isUpD5=true (cumulativeAR[d5] > 0)', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      expect(ar.isUpD5).toBe(true);
    });

    it('should have isCrashD5=false (cumulativeAR[d5] not < -5)', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      expect(ar.isCrashD5).toBe(false);
    });

    it('should have maxDrawdown=0 (price only goes up then stays flat)', () => {
      const ar = calcAR(stockPriceWindows, marketPriceWindows, d0Date);
      // D0=100, D+1=105, D+2..D+20=105 → no drawdown
      expect(ar.maxDrawdown).toBeCloseTo(0, 5);
    });

    it('should compute maxDrawdown correctly for a declining price', () => {
      // 주가가 D0=100, D+1=90, D+2=80, 이후 flat 80
      const decliningStock = [
        ...Array(20).fill(100), // D-20~D-1 전날
        100, // D0
        90,  // D+1
        80,  // D+2
        ...Array(18).fill(80), // D+3~D+20
      ];
      const flatMarket = Array(41).fill(100);
      const dws = makePriceSequence(decliningStock, startDate);
      const mws = makePriceSequence(flatMarket, startDate);
      const ar = calcAR(dws, mws, d0Date);
      // peak=100 at D0, trough=80 → MDD = 20%
      expect(ar.maxDrawdown).toBeCloseTo(20, 1);
      expect(ar.isUpD5).toBe(false); // cumulativeAR[d5] = sum of ARs d1..d5
      expect(ar.isCrashD5).toBe(true); // >5% drop
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. event-study.service.ts
// ─────────────────────────────────────────────────────────────────

/**
 * 35개 관측치 Fixture 생성:
 * - Stock: D0=100, D+1=105, D+2~D+20=105 (D+1에서 5% 점프)
 * - Market: 항상 flat 100
 * → cumulativeAR['d1'] = 5% for all 35 obs
 * → mean = 5, stdDev ≈ 0 → t = Infinity → p = 0 → isSignificant = true
 */
function makeObservation(
  idx: number,
  stockJumpOnD1 = true,
): EventObservationInput {
  // 각 관측치마다 다른 시작 날짜 사용 (날짜 겹침 방지, 실제로는 무관)
  // 날짜 기반 가격 배열: 단순히 동일한 패턴
  const startDate = '20250103';
  const baseDate = new Date(2025, 0, 3);
  baseDate.setDate(baseDate.getDate() + idx * 0); // 모든 obs 동일 날짜 사용 가능 (독립)

  // 41일 가격: D0=100, D+1=105(jump) or 100(no jump)
  const d1Price = stockJumpOnD1 ? 105 : 100;
  const stockPrices = [
    ...Array(21).fill(100),    // indices 0~20 (D-20 prev~D0)
    ...Array(20).fill(d1Price), // indices 21~40 (D+1~D+20)
  ];
  const marketPrices = Array(41).fill(100);

  const stockPriceWindows: PriceWindow[] = stockPrices.map((price, i) => {
    const d = new Date(2025, 0, 3 + i);
    const y = d.getFullYear().toString();
    const mo = (d.getMonth() + 1).toString().padStart(2, '0');
    const da = d.getDate().toString().padStart(2, '0');
    return { date: `${y}${mo}${da}`, closePrice: price };
  });

  const marketPriceWindows: PriceWindow[] = marketPrices.map((price, i) => {
    const d = new Date(2025, 0, 3 + i);
    const y = d.getFullYear().toString();
    const mo = (d.getMonth() + 1).toString().padStart(2, '0');
    const da = d.getDate().toString().padStart(2, '0');
    return { date: `${y}${mo}${da}`, closePrice: price };
  });

  // D0 = 2025-01-23 (index 20 from 2025-01-03)
  const d0Date = '20250123';

  return {
    eventId: `evt-${idx}`,
    rcpNo: `rcp-${idx}`,
    corpCode: `corp-${idx % 10}`,
    stockCode: `stock-${idx % 10}`,
    eventType: 'SUPPLY_CONTRACT',
    bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
    d0Date,
    stockPrices: stockPriceWindows,
    marketPrices: marketPriceWindows,
  };
}

describe('EventStudyService', () => {
  let service: EventStudyService;

  beforeEach(() => {
    service = new EventStudyService();
  });

  describe('aggregate() — INSUFFICIENT (n < 30)', () => {
    it('should return status=INSUFFICIENT for n=5', () => {
      const observations = Array.from({ length: 5 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.status).toBe('INSUFFICIENT');
      expect(result.isSignificant).toBe(false);
      expect(result.tStatistic).toBeNull();
      expect(result.pValue).toBeNull();
      expect(result.sampleCount).toBe(5);
      expect(result.avgArD1).toBe(0);
    });
  });

  describe('aggregate() — READY (n=35)', () => {
    it('should return status=READY for n=35', () => {
      const observations = Array.from({ length: 35 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.status).toBe('READY');
      expect(result.sampleCount).toBe(35);
    });

    it('should compute avgArD1 ≈ 5 for uniform +5% fixture', () => {
      const observations = Array.from({ length: 35 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.avgArD1).toBeCloseTo(5, 3);
    });

    it('should have tStatistic = Infinity (all obs identical)', () => {
      const observations = Array.from({ length: 35 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.tStatistic).toBe(Infinity);
    });

    it('should have pValue = 0 (Infinity t)', () => {
      const observations = Array.from({ length: 35 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.pValue).toBe(0);
    });

    it('should have isSignificant=true (p < 0.05)', () => {
      const observations = Array.from({ length: 35 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.isSignificant).toBe(true);
    });

    it('should have upProbD5=1 when all obs have +5% AR at D5', () => {
      const observations = Array.from({ length: 35 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.upProbD5).toBeCloseTo(1, 5);
    });

    it('should have crashProbD5=0 when none crash', () => {
      const observations = Array.from({ length: 35 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });

      expect(result.crashProbD5).toBe(0);
    });
  });

  describe('MIN_SAMPLE_SIZE constant', () => {
    it('should be 30', () => {
      expect(MIN_SAMPLE_SIZE).toBe(30);
    });
  });

  describe('getEventStudyScore()', () => {
    it('should return 0 for null result', () => {
      expect(service.getEventStudyScore(null)).toBe(0);
    });

    it('should return 0 for INSUFFICIENT result', () => {
      const observations = Array.from({ length: 5 }, (_, i) => makeObservation(i));
      const result = service.aggregate({
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'SUPPLY_CONTRACT__ratio_5to20',
        marketType: 'ALL',
        observations,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      });
      expect(service.getEventStudyScore(result)).toBe(0);
    });

    it('should return 0 for non-significant result', () => {
      // Non-significant result: force isSignificant=false
      const mockResult = {
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'test',
        marketType: 'ALL',
        status: 'READY' as const,
        sampleCount: 35,
        isSignificant: false,
        tStatistic: 1.0,
        pValue: 0.32,
        variance: 1.0,
        avgReturnD1: 5,
        avgReturnD3: 8,
        avgReturnD5: 6,
        avgReturnD20: 10,
        avgArD1: 5,
        avgArD3: 8,
        avgArD5: 6,
        avgArD20: 10,
        upProbD5: 0.7,
        crashProbD5: 0.1,
        avgMaxDrawdown: 5,
        avgVolumeRatioD1: 2.0,
        avgVolumeRatioD3: 1.5,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      };
      expect(service.getEventStudyScore(mockResult)).toBe(0);
    });

    it('should return 15 for avgArD5=6, upProbD5=0.7, significant result', () => {
      // avgArD5=6 ≥ 5 → +10
      // upProbD5=0.7 ≥ 0.65 → +5
      // crashProbD5=0.05 < 0.20 → no penalty
      // total = 15
      const mockResult = {
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'test',
        marketType: 'ALL',
        status: 'READY' as const,
        sampleCount: 35,
        isSignificant: true,
        tStatistic: 5.0,
        pValue: 0.001,
        variance: 1.0,
        avgReturnD1: 5,
        avgReturnD3: 8,
        avgReturnD5: 6,
        avgReturnD20: 10,
        avgArD1: 5,
        avgArD3: 8,
        avgArD5: 6,
        avgArD20: 10,
        upProbD5: 0.7,
        crashProbD5: 0.05,
        avgMaxDrawdown: 5,
        avgVolumeRatioD1: 2.0,
        avgVolumeRatioD3: 1.5,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      };
      expect(service.getEventStudyScore(mockResult)).toBe(15);
    });

    it('should clamp score to [-20, 20]', () => {
      // avgArD5 = -10 → -10, upProbD5=0.30 < 0.40 → -5, crashProbD5=0.25 ≥ 0.20 → -5
      // total = -20 (already at boundary)
      const mockResult = {
        eventType: 'SUPPLY_CONTRACT',
        bucketKey: 'test',
        marketType: 'ALL',
        status: 'READY' as const,
        sampleCount: 35,
        isSignificant: true,
        tStatistic: -5.0,
        pValue: 0.001,
        variance: 1.0,
        avgReturnD1: -5,
        avgReturnD3: -8,
        avgReturnD5: -6,
        avgReturnD20: -10,
        avgArD1: -5,
        avgArD3: -8,
        avgArD5: -10,
        avgArD20: -10,
        upProbD5: 0.30,
        crashProbD5: 0.25,
        avgMaxDrawdown: 20,
        avgVolumeRatioD1: 0.5,
        avgVolumeRatioD3: 0.5,
        dataFromDate: '20250101',
        dataToDate: '20250630',
      };
      const score = service.getEventStudyScore(mockResult);
      expect(score).toBeGreaterThanOrEqual(-20);
      expect(score).toBeLessThanOrEqual(20);
      expect(score).toBe(-20);
    });
  });
});
