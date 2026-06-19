import { isValidDailyOhlc } from './daily-price-sanity';

// DAR-376: 일봉 OHLC 행 단위 품질 가드 — EventStudy backbone 에 손상 행 차단.
describe('isValidDailyOhlc (DAR-376)', () => {
  const ok = { openPrice: 70_000, highPrice: 71_000, lowPrice: 69_500, closePrice: 70_500 };

  it('정상 OHLC(양수·고≥저·시·종 [저,고] 내) → true', () => {
    expect(isValidDailyOhlc(ok)).toBe(true);
  });

  it('시가=고가=저가=종가(상·하한가 등 변동 0) → true', () => {
    expect(isValidDailyOhlc({ openPrice: 5_000, highPrice: 5_000, lowPrice: 5_000, closePrice: 5_000 })).toBe(true);
  });

  it('종가 0 → false (거래정지·누락 잔재)', () => {
    expect(isValidDailyOhlc({ ...ok, closePrice: 0 })).toBe(false);
  });

  it('음수 가격 → false', () => {
    expect(isValidDailyOhlc({ ...ok, lowPrice: -1 })).toBe(false);
  });

  it('고가 < 저가 → false (물리적 불가)', () => {
    expect(isValidDailyOhlc({ openPrice: 100, highPrice: 90, lowPrice: 110, closePrice: 100 })).toBe(false);
  });

  it('종가가 [저,고] 범위 밖 → false', () => {
    expect(isValidDailyOhlc({ ...ok, closePrice: 80_000 })).toBe(false);
  });

  it('시가가 [저,고] 범위 밖 → false', () => {
    expect(isValidDailyOhlc({ ...ok, openPrice: 60_000 })).toBe(false);
  });
});
