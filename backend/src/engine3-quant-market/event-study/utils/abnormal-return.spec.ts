// 회귀 안전망 (DAR-127): 초과수익(AR) 계산 — 일별/누적 AR·최대낙폭·거래량비율·방어로직.
// 순수 함수. Event Study 통계가 매수신호 입력으로 흐르므로 결측·경계 회귀 방어.
import { calcAR, calcDailyReturn, PriceWindow } from './abnormal-return';

const pw = (date: string, closePrice: number): PriceWindow => ({ date, closePrice });

describe('calcDailyReturn (DAR-127)', () => {
  it('상승률 % 계산', () => {
    expect(calcDailyReturn(100, 110)).toBeCloseTo(10);
  });
  it('하락률 % 계산', () => {
    expect(calcDailyReturn(100, 90)).toBeCloseTo(-10);
  });
  it('from=0 → 0 (분모 보호)', () => {
    expect(calcDailyReturn(0, 50)).toBe(0);
  });
});

describe('calcAR (DAR-127 회귀 안전망)', () => {
  // D-2..D+5 = 8개 (인덱스 0..7), D0은 인덱스 2.
  const stock: PriceWindow[] = [
    pw('20260101', 100), // D-2
    pw('20260102', 100), // D-1
    pw('20260105', 110), // D0  (+10% vs D-1)
    pw('20260106', 121), // D+1 (+10%)
    pw('20260107', 121), // D+2 (0%)
    pw('20260108', 130), // D+3
    pw('20260109', 125), // D+4
    pw('20260112', 132), // D+5
  ];
  // 시장은 전부 평탄(0% 수익률) → AR == 종목 수익률.
  const market: PriceWindow[] = stock.map((p) => pw(p.date, 1000));

  it('d0 수익률 = D-1→D0', () => {
    const r = calcAR(stock, market, '20260105');
    expect(r.dailyReturns['d0']).toBeCloseTo(10);
  });

  it('일별 AR = 종목수익률 - 시장수익률 (시장 평탄 → 종목수익률과 동일)', () => {
    const r = calcAR(stock, market, '20260105');
    expect(r.dailyAR['d1']).toBeCloseTo(r.dailyReturns['d1']);
    expect(r.marketReturns['d1']).toBeCloseTo(0);
  });

  it('누적 AR(d5)이 d1~d5 일별 AR 합과 일치', () => {
    const r = calcAR(stock, market, '20260105');
    const sum = ['d1', 'd2', 'd3', 'd4', 'd5'].reduce((s, k) => s + (r.dailyAR[k] ?? 0), 0);
    expect(r.cumulativeAR['d5']).toBeCloseTo(sum);
  });

  it('isUpD5 — 누적 AR(d5) > 0이면 true', () => {
    const r = calcAR(stock, market, '20260105');
    expect(r.isUpD5).toBe(r.cumulativeAR['d5'] > 0);
    expect(r.isUpD5).toBe(true);
  });

  it('isCrashD5 — 급락 종목은 누적 AR(d5) < -5', () => {
    const crash: PriceWindow[] = [
      pw('20260101', 100),
      pw('20260102', 100),
      pw('20260105', 100), // D0
      pw('20260106', 90),
      pw('20260107', 85),
      pw('20260108', 80),
      pw('20260109', 78),
      pw('20260112', 75),
    ];
    const flat = crash.map((p) => pw(p.date, 1000));
    const r = calcAR(crash, flat, '20260105');
    expect(r.isCrashD5).toBe(true);
    expect(r.cumulativeAR['d5']).toBeLessThan(-5);
  });

  it('최대낙폭 — D0~D+20 고점 대비 저점 하락률(%)', () => {
    const dd: PriceWindow[] = [
      pw('20260105', 100), // D0
      pw('20260106', 120), // peak
      pw('20260107', 90), // -25% from 120
    ];
    const flat = dd.map((p) => pw(p.date, 1));
    const r = calcAR(dd, flat, '20260105');
    expect(r.maxDrawdown).toBeCloseTo(25);
  });

  it('D0 미발견 → 방어 로직(중앙 인덱스)으로 결과 산출(throw 없음)', () => {
    const r = calcAR(stock, market, '99999999');
    expect(r).toBeDefined();
    expect(typeof r.maxDrawdown).toBe('number');
  });

  describe('거래량 비율', () => {
    const volumes: PriceWindow[] = [
      pw('20260105', 0), // D0 (거래량을 closePrice 자리에 실음)
      pw('20260106', 200), // D+1
      pw('20260107', 300), // D+2
      pw('20260108', 400), // D+3
    ];
    const baseline: PriceWindow[] = [pw('20251230', 100), pw('20251231', 100)]; // 평균 100

    it('volumes/baseline 제공 시 D+1·D+3 비율 산출', () => {
      const r = calcAR(stock, market, '20260105', volumes, baseline);
      expect(r.volumeRatios['d1']).toBeCloseTo(2); // 200/100
      expect(r.volumeRatios['d3']).toBeCloseTo(3); // (200+300+400)/3 / 100
    });

    it('baseline 평균 0 → 기본 {d1:1, d3:1}(가짜 비율 금지)', () => {
      const r = calcAR(stock, market, '20260105', volumes, [pw('20251231', 0)]);
      expect(r.volumeRatios).toEqual({ d1: 1, d3: 1 });
    });

    it('volumes/baseline 미제공 → 기본 {d1:1, d3:1}', () => {
      const r = calcAR(stock, market, '20260105');
      expect(r.volumeRatios).toEqual({ d1: 1, d3: 1 });
    });

    it('거래량 배열에 D0 미발견 → 기본 {d1:1, d3:1}', () => {
      const r = calcAR(stock, market, '20260105', [pw('19990101', 500)], baseline);
      expect(r.volumeRatios).toEqual({ d1: 1, d3: 1 });
    });
  });
});
