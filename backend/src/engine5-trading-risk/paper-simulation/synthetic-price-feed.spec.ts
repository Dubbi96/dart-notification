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
  VOL_MIN,
  VOL_MAX,
  MAX_DAILY_RETURN,
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
    it('stockVolatility는 VOL_MIN~VOL_MAX(0.8%~2.2%) 밴드 내 결정적 (DAR-135 캘리브레이션)', () => {
      for (const c of ['005930', '000660', '035720']) {
        const v = stockVolatility(c);
        expect(v).toBeGreaterThanOrEqual(VOL_MIN);
        expect(v).toBeLessThanOrEqual(VOL_MAX);
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

    it('일변동 한도 — open/close/high/low 모두 직전 종가 ±MAX_DAILY_RETURN 내 (DAR-135)', () => {
      // 비현실적 σ(50%)를 줘도 단일일 변동이 한도를 넘지 못함(equity 과도 변동 차단).
      const prev = 50_000;
      const hi = Math.round(prev * (1 + MAX_DAILY_RETURN));
      const lo = Math.round(prev * (1 - MAX_DAILY_RETURN));
      for (const code of ['005930', '000660', '035720', '207940', '068270']) {
        const bar = buildBar(code, '20260608', prev, 0.5);
        expect(bar.openPrice).toBeLessThanOrEqual(hi);
        expect(bar.openPrice).toBeGreaterThanOrEqual(lo);
        expect(bar.closePrice).toBeLessThanOrEqual(hi);
        expect(bar.closePrice).toBeGreaterThanOrEqual(lo);
        expect(bar.highPrice).toBeLessThanOrEqual(hi);
        expect(bar.lowPrice).toBeGreaterThanOrEqual(lo);
      }
    });
  });

  describe('변동성 캘리브레이션 — 현실 범위 일변동(DAR-135)', () => {
    it('실제 σ 밴드(0.8%~2.2%)에서 일간 종가변동이 한도 내·대부분 작음', () => {
      const dates = tradingDaysEndingAt('20260608', 60);
      let maxAbs = 0;
      const code = '005930';
      const series = generateSyntheticSeries(code, dates);
      for (let i = 1; i < series.length; i++) {
        const ret = Math.abs(series[i].closePrice - series[i - 1].closePrice) / series[i - 1].closePrice;
        maxAbs = Math.max(maxAbs, ret);
      }
      // 어떤 날도 한도를 넘지 않는다.
      expect(maxAbs).toBeLessThanOrEqual(MAX_DAILY_RETURN + 1e-9);
      // σ 밴드 상한(2.2%)을 감안해도 현실적: 최대 일변동이 KRX 제한(30%)보다 훨씬 작다.
      expect(maxAbs).toBeLessThan(0.1);
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

    it('seedPrice 주입 시 첫 종가는 그 근방(±일변동 한도)에서 시작', () => {
      const s = generateSyntheticSeries('005930', dates, { seedPrice: 100_000, volatility: 0.03 });
      // DAR-135: 일변동 한도(±MAX_DAILY_RETURN) 안에서 시작.
      expect(s[0].closePrice).toBeGreaterThanOrEqual(Math.round(100_000 * (1 - MAX_DAILY_RETURN)));
      expect(s[0].closePrice).toBeLessThanOrEqual(Math.round(100_000 * (1 + MAX_DAILY_RETURN)));
    });

    // ── DAR-135 변동성 캘리브레이션: 일변동 한도·현실 범위·0근방 집중 ──
    describe('DAR-135 변동성 캘리브레이션', () => {
      const longDates = tradingDaysEndingAt('20260608', 120);

      it('일간 종가 변동률이 ±MAX_DAILY_RETURN(7%) 한도를 절대 넘지 않는다 (다종목·다일)', () => {
        for (const code of ['005930', '000660', '035720', '207940', '068270']) {
          const s = generateSyntheticSeries(code, longDates);
          for (let i = 1; i < s.length; i++) {
            const ret = (s[i].closePrice - s[i - 1].closePrice) / s[i - 1].closePrice;
            expect(Math.abs(ret)).toBeLessThanOrEqual(MAX_DAILY_RETURN + 1e-9);
          }
        }
      });

      it('전형적 일변동(중앙값)이 작다 — 평탄 균등이 아니라 0 근방 집중', () => {
        const s = generateSyntheticSeries('005930', longDates);
        const moves: number[] = [];
        for (let i = 1; i < s.length; i++) {
          moves.push(Math.abs((s[i].closePrice - s[i - 1].closePrice) / s[i - 1].closePrice));
        }
        moves.sort((a, b) => a - b);
        const median = moves[Math.floor(moves.length / 2)];
        // 종목 σ(≤2.2%) 대비 중앙값은 그보다 작아야 한다(근사정규는 |median|≈0.67σ).
        expect(median).toBeLessThan(VOL_MAX);
        // 그래도 평탄선은 아님(변동 존재).
        expect(median).toBeGreaterThan(0);
      });

      it('120거래일 누적가도 합리적 배수 범위(0.2x~5x) — 폭주하지 않음', () => {
        for (const code of ['005930', '000660', '035720']) {
          const s = generateSyntheticSeries(code, longDates);
          const first = s[0].closePrice;
          const last = s[s.length - 1].closePrice;
          expect(last).toBeGreaterThan(first * 0.2);
          expect(last).toBeLessThan(first * 5);
        }
      });

      it('결정성 보존 — 동일 입력 2회 byte-identical', () => {
        expect(generateSyntheticSeries('005930', longDates)).toEqual(
          generateSyntheticSeries('005930', longDates),
        );
      });
    });
  });
});
