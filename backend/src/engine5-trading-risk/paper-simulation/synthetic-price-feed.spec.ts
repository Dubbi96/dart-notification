/**
 * synthetic-price-feed.spec.ts — 결정적 합성 일봉 생성기 단위테스트 (DAR-124, DB 미사용)
 *
 * 핵심: 동일 입력 → 동일 출력(재현·멱등), 거래일 캘린더, OHLC 불변식, 종목별 변동성 차이,
 *   날짜별 종가 변화(스냅샷이 가격변동을 반영할 수 있는 전제). 실시세 아님 — 모의 전용.
 */

import {
  hashSeed,
  mulberry32,
  baseSeedPrice,
  stockVolatility,
  isTradingDay,
  prevTradingDay,
  tradingDaysEndingAt,
  generateSyntheticSeries,
  buildBar,
} from './synthetic-price-feed';

describe('synthetic-price-feed — 결정적 합성 일봉(DAR-124)', () => {
  describe('hashSeed / mulberry32 — 결정적 시드 PRNG', () => {
    it('동일 문자열은 동일 해시', () => {
      expect(hashSeed('005930')).toBe(hashSeed('005930'));
      expect(hashSeed('a')).not.toBe(hashSeed('b'));
    });
    it('동일 시드 PRNG는 동일 수열(2회 호출 동일)', () => {
      const a = mulberry32(123);
      const b = mulberry32(123);
      const seqA = [a(), a(), a()];
      const seqB = [b(), b(), b()];
      expect(seqA).toEqual(seqB);
      // [0,1) 범위
      for (const v of seqA) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('isTradingDay / prevTradingDay / tradingDaysEndingAt — 거래일 캘린더', () => {
    it('주말은 거래일 아님(2026-06-06 토, 06-07 일)', () => {
      expect(isTradingDay('20260605')).toBe(true); // 금
      expect(isTradingDay('20260606')).toBe(false); // 토
      expect(isTradingDay('20260607')).toBe(false); // 일
      expect(isTradingDay('20260608')).toBe(true); // 월
    });
    it('형식 불량은 거래일 아님', () => {
      expect(isTradingDay('2026')).toBe(false);
      expect(isTradingDay('badvalue')).toBe(false);
    });
    it('월요일 직전 거래일은 금요일(주말 스킵)', () => {
      expect(prevTradingDay('20260608')).toBe('20260605');
    });
    it('endDate 포함 거래일 N개를 오름차순 반환(주말 제외·중복 없음)', () => {
      const days = tradingDaysEndingAt('20260608', 5);
      expect(days).toEqual(['20260602', '20260603', '20260604', '20260605', '20260608']);
      expect(days.every(isTradingDay)).toBe(true);
    });
    it('endDate가 주말이면 직전 거래일부터 카운트', () => {
      const days = tradingDaysEndingAt('20260606', 1); // 토 → 금
      expect(days).toEqual(['20260605']);
    });
    it('count<=0 이면 빈 배열', () => {
      expect(tradingDaysEndingAt('20260608', 0)).toEqual([]);
    });
  });

  describe('종목별 차별화 — 기준가·변동성', () => {
    it('baseSeedPrice는 종목별 결정적·하한 1000원·10원 단위', () => {
      expect(baseSeedPrice('005930')).toBe(baseSeedPrice('005930'));
      expect(baseSeedPrice('005930')).toBeGreaterThanOrEqual(1_000);
      expect(baseSeedPrice('005930') % 10).toBe(0);
    });
    it('서로 다른 종목은 기준가/변동성이 일반적으로 다름', () => {
      const codes = ['005930', '000660', '035720', '207940', '068270'];
      const prices = new Set(codes.map(baseSeedPrice));
      const vols = new Set(codes.map(stockVolatility));
      expect(prices.size).toBeGreaterThan(1);
      expect(vols.size).toBeGreaterThan(1);
    });
    it('stockVolatility는 1.2%~4.0% 밴드 내 결정적', () => {
      for (const c of ['005930', '000660', '035720']) {
        const v = stockVolatility(c);
        expect(v).toBeGreaterThanOrEqual(0.012);
        expect(v).toBeLessThanOrEqual(0.04);
        expect(stockVolatility(c)).toBe(v);
      }
    });
  });

  describe('buildBar — OHLC 불변식', () => {
    it('high>=max(open,close), low<=min(open,close), 모든 가격>=하한', () => {
      const bar = buildBar('005930', '20260608', 50_000, 0.03);
      expect(bar.highPrice).toBeGreaterThanOrEqual(Math.max(bar.openPrice, bar.closePrice));
      expect(bar.lowPrice).toBeLessThanOrEqual(Math.min(bar.openPrice, bar.closePrice));
      expect(bar.lowPrice).toBeGreaterThanOrEqual(100);
      expect(bar.volume).toBeGreaterThan(0);
    });
    it('동일 (stockCode, tradeDate, prevClose, σ)는 동일 OHLCV(멱등)', () => {
      const a = buildBar('005930', '20260608', 50_000, 0.03);
      const b = buildBar('005930', '20260608', 50_000, 0.03);
      expect(a).toEqual(b);
    });
  });

  describe('generateSyntheticSeries — 재현·날짜별 변화', () => {
    const dates = tradingDaysEndingAt('20260608', 10);

    it('동일 입력은 동일 시계열(2회 생성 byte-identical)', () => {
      const s1 = generateSyntheticSeries('005930', dates);
      const s2 = generateSyntheticSeries('005930', dates);
      expect(s1).toEqual(s2);
      expect(s1).toHaveLength(dates.length);
    });

    it('거래일마다 종가가 변한다(스냅샷이 가격변동을 반영할 전제)', () => {
      const s = generateSyntheticSeries('005930', dates);
      const closes = s.map((b) => b.closePrice);
      const distinct = new Set(closes);
      // 최소한 하나 이상 변동 — 평탄선이 아님
      expect(distinct.size).toBeGreaterThan(1);
      // 모든 종가 양수(매수 가능 전제: price>0)
      expect(closes.every((c) => c > 0)).toBe(true);
    });

    it('각 행의 tradeDate가 입력 거래일과 1:1 오름차순', () => {
      const s = generateSyntheticSeries('005930', dates);
      expect(s.map((b) => b.tradeDate)).toEqual(dates);
    });

    it('seedPrice 주입 시 첫 종가는 그 근방(±σ)에서 시작', () => {
      const s = generateSyntheticSeries('005930', dates, { seedPrice: 100_000, volatility: 0.03 });
      expect(s[0].closePrice).toBeGreaterThan(100_000 * (1 - 0.05));
      expect(s[0].closePrice).toBeLessThan(100_000 * (1 + 0.05));
    });
  });
});
