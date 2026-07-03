// DAR-493 — 코어 듀얼모멘텀 월말 리밸런싱 백테스트 순수 함수 결정론 검증.
// 룩백은 opts.lookback=2 로 축소해 모멘텀을 통제(판정 로직 자체는 P12 spec 이 검증).
// 여기선 백테스트 배선(asOf 절단·익일 시가 체결·SWITCH 라운드트립 기록·warmup 결측 보류)을 검증.

import { backtestCoreDualMomentum } from './core-dual-momentum-backtest';
import { DatedBar } from './two-tier-backtest.types';
import {
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
} from '../dual-momentum/dual-momentum.constants';

/** {date, close} 목록 → OHLC 동일가 DatedBar[]. */
function series(closesByDate: [string, number][]): DatedBar[] {
  return closesByDate.map(([date, c]) => ({ date, open: c, high: c, low: c, close: c }));
}

// 8 거래일(월별 2봉): Jan10/20, Feb10/20, Mar10/20, Apr10/20. 월말=20일.
const DATES = ['20230110', '20230120', '20230210', '20230220', '20230310', '20230320', '20230410', '20230420'];
const mk = (closes: number[]): DatedBar[] => series(DATES.map((d, i) => [d, closes[i]]));

describe('backtestCoreDualMomentum', () => {
  it('warmup 결측 보류 → 상대모멘텀 SWITCH(A→B) 라운드트립 기록', () => {
    // A: 상승 후 정체 / B: 정체 후 급등 / T·DEF: 정체.
    const universe = {
      [CORE_OFFENSE_INTL_CODE]: mk([100, 110, 120, 130, 130, 130, 130, 130]),
      [CORE_OFFENSE_DOMESTIC_CODE]: mk([100, 100, 100, 100, 100, 140, 180, 220]),
      '153130': mk([100, 100, 100, 100, 100, 100, 100, 100]),
      '273130': mk([100, 100, 100, 100, 100, 100, 100, 100]),
    };
    const r = backtestCoreDualMomentum(universe, { initialCapital: 10_000_000, lookback: 2 });

    // 월말 판정 4회(Jan/Feb/Mar/Apr).
    expect(r.sampleCount).toBe(4);
    // Jan-end: 2봉<3 → 결측 보류(현금). Feb-end: A 승 → 현금→A 매수(Mar10 시가). Mar-end: B 승 → A 매도→B(Apr10 시가). Apr-end: B 유지.
    // A 라운드트립 1건이 SWITCH_EXIT 로 확정 기록된다(종료 시 B 보유는 openTrade — trades 미포함).
    expect(r.trades.length).toBe(1);
    const a = r.trades[0];
    expect(a.assetCode).toBe(CORE_OFFENSE_INTL_CODE);
    expect(a.entryDate).toBe('20230310'); // Feb-end 판정 → 익일 시가(Mar10)
    expect(a.exitDate).toBe('20230410'); // Mar-end 판정(B 승) → 익일 시가(Apr10)
    expect(a.reason).toBe('SWITCH_EXIT');
    expect(a.holdDays).toBe(2); // Mar10..Apr10 = union 2칸
    expect(a.netPnl).not.toBeNull();
    expect(r.equityCurve.length).toBe(8);
    expect(r.equityCurve[r.equityCurve.length - 1].date).toBe('20230420');
  });

  it('전 구간 이력 부족(모든 판정에서 253/lookback 미달) → 무거래·현금 유지', () => {
    // lookback 기본(252) 이면 8봉으론 항상 결측 → 판정 보류.
    const universe = {
      [CORE_OFFENSE_INTL_CODE]: mk([100, 110, 120, 130, 140, 150, 160, 170]),
      [CORE_OFFENSE_DOMESTIC_CODE]: mk([100, 100, 100, 100, 100, 100, 100, 100]),
      '153130': mk([100, 100, 100, 100, 100, 100, 100, 100]),
      '273130': mk([100, 100, 100, 100, 100, 100, 100, 100]),
    };
    const r = backtestCoreDualMomentum(universe, { initialCapital: 10_000_000 }); // 기본 룩백 252
    expect(r.trades.length).toBe(0);
    expect(r.finalEquity).toBe(10_000_000); // 현금 유지(무행동)
    expect(r.sampleCount).toBe(4);
  });

  it('빈 유니버스 → graceful(무거래)', () => {
    const r = backtestCoreDualMomentum({}, { initialCapital: 10_000_000 });
    expect(r.trades.length).toBe(0);
    expect(r.finalEquity).toBe(10_000_000);
    expect(r.equityCurve.length).toBe(0);
  });
});
