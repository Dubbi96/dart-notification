// DAR-493 — 위성 변동성 돌파 일단위 백테스트 순수 함수 결정론 검증.

import { backtestSatelliteBreakout } from './satellite-breakout-backtest';
import { DatedBar } from './two-tier-backtest.types';
import { SATELLITE_TARGET_ETF_CODE } from '../volatility-breakout/volatility-breakout.constants';

function bar(date: string, o: number, h: number, l: number, c: number): DatedBar {
  return { date, open: o, high: h, low: l, close: c };
}

describe('backtestSatelliteBreakout', () => {
  it('돌파 발생 → 1건 진입·익일 시가 청산·ETF 비용(거래세 0)', () => {
    const bars: DatedBar[] = [
      bar('20230102', 100, 102, 98, 100), // prev (Range=4)
      bar('20230103', 100, 110, 99, 108), // target=100+4*0.5=102, high 110≥102 → 진입
      bar('20230104', 109, 109, 105, 106), // 청산 시가 109. (t=2 prev Range=11 target≈114.5 → 미돌파)
      bar('20230105', 106, 107, 104, 105), // t=3, t+1 없음 → 미진입
    ];
    const r = backtestSatelliteBreakout(bars, { initialCapital: 10_000_000 });
    expect(r.styleTag).toBe('satellite:vol-breakout');
    expect(r.trades.length).toBe(1);
    const t = r.trades[0];
    expect(t.assetCode).toBe(SATELLITE_TARGET_ETF_CODE);
    expect(t.entryDate).toBe('20230103');
    expect(t.exitDate).toBe('20230104');
    expect(t.holdDays).toBe(1);
    expect(t.reason).toContain('BREAKOUT');
    // 진입 fill=102, 청산 109 → 비용 후에도 순이익 양수
    expect(t.netPnl).not.toBeNull();
    expect(t.netPnl as number).toBeGreaterThan(0);
    expect(r.finalEquity).toBeGreaterThan(10_000_000);
    expect(r.sampleCount).toBe(3); // t=1,2,3 평가
  });

  it('돌파 없음(고가가 목표 미달) → 0건', () => {
    const bars: DatedBar[] = [
      bar('20230102', 100, 102, 98, 100),
      bar('20230103', 100, 101, 99, 100), // target 102, high 101 < 102 → 미진입
      bar('20230104', 100, 101, 99, 100),
    ];
    const r = backtestSatelliteBreakout(bars, { initialCapital: 10_000_000 });
    expect(r.trades.length).toBe(0);
    expect(r.finalEquity).toBe(10_000_000);
  });

  it('전일 Range=0(거래정지) → 목표가 null → 미진입', () => {
    const bars: DatedBar[] = [
      bar('20230102', 100, 100, 100, 100), // Range 0
      bar('20230103', 100, 120, 99, 110),
      bar('20230104', 110, 111, 108, 109),
    ];
    const r = backtestSatelliteBreakout(bars, { initialCapital: 10_000_000 });
    expect(r.trades.length).toBe(0);
  });

  it('빈/단일 바 → graceful(0건)', () => {
    expect(backtestSatelliteBreakout([]).trades.length).toBe(0);
    expect(backtestSatelliteBreakout([bar('20230102', 100, 102, 98, 100)]).trades.length).toBe(0);
  });
});
