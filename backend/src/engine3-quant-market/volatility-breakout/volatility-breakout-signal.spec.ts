// DAR-491 — 변동성 돌파 위성 신호·사이징(순수 Rule) 결정론 검증.
// 검증 대상: 목표가·변동성 조절 사이징·경계(Range 0·결측·호가단위)·frozen K 불변성·추세 필터.

import {
  OhlcBar,
  computeBreakoutTarget,
  computeRangePct,
  computeVolSizingFactor,
  computeVolAdjustedSizing,
  computeSma,
  passesTrendFilter,
  evaluateBreakoutEntry,
  alignToTick,
  DEFAULT_BREAKOUT_ENTRY_PARAMS,
  BREAKOUT_ENTRY_TAG,
} from './volatility-breakout-signal';
import { VOL_BREAKOUT_K, TARGET_DAILY_VOL_PCT } from './volatility-breakout.constants';

/** 일봉 fixture: close=open=mid, Range=H−L. */
function bar(open: number, high: number, low: number, close: number): OhlcBar {
  return { open, high, low, close };
}

// ---------------------------------------------------------------------------
// alignToTick (호가단위 반올림 정렬)
// ---------------------------------------------------------------------------
describe('alignToTick', () => {
  it('이미 정렬된 가격은 변하지 않는다', () => {
    expect(alignToTick(2100)).toBe(2100); // tick=5 → 2100/5=420 정확
    expect(alignToTick(50100)).toBe(50100); // tick=100
  });

  it('비정렬 가격을 최근접 호가로 반올림한다', () => {
    // price=40125, tick=50 → round(40125/50)*50 = round(802.5)*50 = 803*50 = 40150
    expect(alignToTick(40125)).toBe(40150);
    // price=2100.5, tick=5 → round(2100.5/5)*5 = round(420.1)*5 = 420*5 = 2100
    expect(alignToTick(2100.5)).toBe(2100);
  });
});

// ---------------------------------------------------------------------------
// computeBreakoutTarget (목표가)
// ---------------------------------------------------------------------------
describe('computeBreakoutTarget', () => {
  it('정상 입력: 목표가 = 시가 + Range × K, 호가 정렬', () => {
    // prevBar H=102, L=98, Range=4 / open=100, K=0.5
    // raw = 100 + 4*0.5 = 102, tick=1(price<2000) → 102
    const target = computeBreakoutTarget(bar(99, 102, 98, 100), 100, 0.5);
    expect(target).toBe(102);
  });

  it('호가단위 정렬이 적용된다(비정렬 raw → nearest tick)', () => {
    // prevBar H=40300, L=40000, Range=300 / open=40000, K=0.5
    // raw = 40000 + 300*0.5 = 40150, tick=50 → alignToTick(40150)=40150(already aligned)
    // Use K to produce unaligned raw:
    // prevBar H=40250, L=40000, Range=250 / open=40000, K=0.5
    // raw = 40000 + 125 = 40125, tick=50 → 40150
    const target = computeBreakoutTarget(bar(40100, 40250, 40000, 40100), 40000, 0.5);
    expect(target).toBe(40150);
  });

  it('K=0 이면 목표가 = 당일 시가(호가 정렬)', () => {
    const target = computeBreakoutTarget(bar(99, 102, 98, 100), 2000, 0);
    expect(target).toBe(2000);
  });

  it('전일 Range ≤ 0 (H=L) → null(진입 스킵)', () => {
    expect(computeBreakoutTarget(bar(100, 100, 100, 100), 100, 0.5)).toBeNull();
  });

  it('prevBar null → null', () => {
    expect(computeBreakoutTarget(null, 100, 0.5)).toBeNull();
  });

  it('prevBar undefined → null', () => {
    expect(computeBreakoutTarget(undefined, 100, 0.5)).toBeNull();
  });

  it('todayOpen 0 → null', () => {
    expect(computeBreakoutTarget(bar(99, 102, 98, 100), 0, 0.5)).toBeNull();
  });

  it('todayOpen 음수 → null', () => {
    expect(computeBreakoutTarget(bar(99, 102, 98, 100), -1, 0.5)).toBeNull();
  });

  it('k = NaN → null', () => {
    expect(computeBreakoutTarget(bar(99, 102, 98, 100), 100, NaN)).toBeNull();
  });

  it('기본 K 파라미터 누락 시 VOL_BREAKOUT_K(0.5)를 사용한다(frozen K)', () => {
    const withDefault = computeBreakoutTarget(bar(99, 102, 98, 100), 100);
    const withExplicit = computeBreakoutTarget(bar(99, 102, 98, 100), 100, 0.5);
    expect(withDefault).toBe(withExplicit);
  });
});

// ---------------------------------------------------------------------------
// frozen K 불변성 (§9.1: K=0.5 a-priori frozen)
// ---------------------------------------------------------------------------
describe('frozen K 불변성', () => {
  it('VOL_BREAKOUT_K 상수 값이 0.5 (frozen)', () => {
    expect(VOL_BREAKOUT_K).toBe(0.5);
  });

  it('DEFAULT_BREAKOUT_ENTRY_PARAMS.k 가 VOL_BREAKOUT_K 를 그대로 참조', () => {
    expect(DEFAULT_BREAKOUT_ENTRY_PARAMS.k).toBe(VOL_BREAKOUT_K);
  });

  it('TARGET_DAILY_VOL_PCT 상수 값이 1.0 (frozen)', () => {
    expect(TARGET_DAILY_VOL_PCT).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// computeRangePct (전일 Range%)
// ---------------------------------------------------------------------------
describe('computeRangePct', () => {
  it('(H-L)/close*100 을 반환한다', () => {
    // H=41000, L=40000, close=40000 → 1000/40000*100 = 2.5%
    expect(computeRangePct(bar(40000, 41000, 40000, 40000))).toBeCloseTo(2.5, 6);
  });

  it('Range=0 → null', () => {
    expect(computeRangePct(bar(100, 100, 100, 100))).toBeNull();
  });

  it('null prevBar → null', () => {
    expect(computeRangePct(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeVolSizingFactor (사이징계수)
// ---------------------------------------------------------------------------
describe('computeVolSizingFactor', () => {
  it('rangePct > targetPct → 축소(factor<1)', () => {
    // H=41000, L=40000, close=40000 → rangePct=2.5%, target=1% → factor=1/2.5=0.4
    const factor = computeVolSizingFactor(bar(40000, 41000, 40000, 40000), 1.0);
    expect(factor).toBeCloseTo(0.4, 6);
  });

  it('rangePct < targetPct → 상한 1.0(레버리지 없음)', () => {
    // H=40200, L=40000, close=40000 → rangePct=0.5%, target=1% → raw=2, capped=1
    const factor = computeVolSizingFactor(bar(40000, 40200, 40000, 40000), 1.0);
    expect(factor).toBe(1.0);
  });

  it('rangePct = targetPct → factor = 1.0', () => {
    // H=40400, L=40000, close=40000 → rangePct=1.0%, factor=1/1=1
    const factor = computeVolSizingFactor(bar(40000, 40400, 40000, 40000), 1.0);
    expect(factor).toBeCloseTo(1.0, 6);
  });

  it('null prevBar → null', () => {
    expect(computeVolSizingFactor(null)).toBeNull();
  });

  it('targetDailyVolPct=0 → null', () => {
    expect(computeVolSizingFactor(bar(40000, 41000, 40000, 40000), 0)).toBeNull();
  });

  it('기본 targetDailyVolPct = TARGET_DAILY_VOL_PCT(1.0) 사용', () => {
    const withDefault = computeVolSizingFactor(bar(40000, 41000, 40000, 40000));
    const withExplicit = computeVolSizingFactor(bar(40000, 41000, 40000, 40000), 1.0);
    expect(withDefault).toBeCloseTo(withExplicit!, 10);
  });
});

// ---------------------------------------------------------------------------
// computeVolAdjustedSizing (수량 산출)
// ---------------------------------------------------------------------------
describe('computeVolAdjustedSizing', () => {
  it('floor(allocationKrw × factor / referencePrice) — 정수 수량', () => {
    // prevBar: rangePct=2.5%, factor=0.4 / alloc=1_000_000 / refPrice=40000
    // budget = 400_000 / qty = floor(400_000/40000) = 10
    const qty = computeVolAdjustedSizing(
      bar(40000, 41000, 40000, 40000),
      1.0,
      1_000_000,
      40000,
    );
    expect(qty).toBe(10);
  });

  it('참조가 미지정 시 전일 종가로 폴백', () => {
    const qty = computeVolAdjustedSizing(bar(40000, 41000, 40000, 40000), 1.0, 1_000_000);
    expect(qty).toBe(10); // 전일 종가=40000 사용
  });

  it('factor=1(low volatility) 케이스 — 전액 집행', () => {
    // rangePct=0.5%, factor=1 / alloc=500_000 / refPrice=50000
    // budget = 500_000 / qty = floor(500_000/50000) = 10
    const qty = computeVolAdjustedSizing(
      bar(50000, 50200, 50000, 50000),
      1.0,
      500_000,
      50000,
    );
    expect(qty).toBe(10);
  });

  it('수량은 floor(정수, 소수점 이하 버림)', () => {
    // alloc=1_000_000, factor=0.4, refPrice=39000
    // budget=400_000 / qty = floor(400_000/39000) = floor(10.256...) = 10
    const qty = computeVolAdjustedSizing(
      bar(40000, 41000, 40000, 40000),
      1.0,
      1_000_000,
      39000,
    );
    expect(qty).toBe(10);
  });

  it('allocationKrw=0 → null', () => {
    expect(computeVolAdjustedSizing(bar(40000, 41000, 40000, 40000), 1.0, 0)).toBeNull();
  });

  it('prevBar null → null(전일 데이터 결측 시 진입 스킵)', () => {
    expect(computeVolAdjustedSizing(null, 1.0, 1_000_000)).toBeNull();
  });

  it('Range=0(거래정지) prevBar → null', () => {
    expect(
      computeVolAdjustedSizing(bar(40000, 40000, 40000, 40000), 1.0, 1_000_000),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeSma
// ---------------------------------------------------------------------------
describe('computeSma', () => {
  it('단순 평균을 계산한다', () => {
    expect(computeSma([100, 200, 300])).toBeCloseTo(200, 6);
  });

  it('빈 배열 → null', () => {
    expect(computeSma([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// passesTrendFilter (추세 필터)
// ---------------------------------------------------------------------------
describe('passesTrendFilter', () => {
  it('전일 종가 > SMA(5) → true', () => {
    // closes = [100, 100, 100, 100, 110] → SMA(5)=102, 마지막=110 > 102
    expect(passesTrendFilter([100, 100, 100, 100, 110], 5)).toBe(true);
  });

  it('전일 종가 = SMA(5) → false (초과가 아님)', () => {
    expect(passesTrendFilter([100, 100, 100, 100, 100], 5)).toBe(false);
  });

  it('전일 종가 < SMA(5) → false', () => {
    expect(passesTrendFilter([100, 100, 100, 100, 90], 5)).toBe(false);
  });

  it('표본 부족(length < period) → false(fail-safe 미진입)', () => {
    expect(passesTrendFilter([100, 110], 5)).toBe(false);
  });

  it('빈 배열 → false', () => {
    expect(passesTrendFilter([], 5)).toBe(false);
  });

  it('period=0 → false', () => {
    expect(passesTrendFilter([100, 110], 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateBreakoutEntry (통합 진입 판정)
// ---------------------------------------------------------------------------
describe('evaluateBreakoutEntry', () => {
  const prevBar = bar(99, 102, 98, 100); // Range=4, rangePct=4%

  it('현재가 ≥ 목표가, 추세필터 OFF → 진입', () => {
    // target = 100 + 4*0.5 = 102
    const d = evaluateBreakoutEntry(prevBar, 100, 102);
    expect(d.triggered).toBe(true);
    expect(d.targetPrice).toBe(102);
    expect(d.reachedTarget).toBe(true);
    expect(d.trendOk).toBe(true); // filter OFF → always true
    expect(d.insufficientData).toBe(false);
    expect(d.detail).toContain(BREAKOUT_ENTRY_TAG);
  });

  it('현재가 < 목표가 → 미진입', () => {
    const d = evaluateBreakoutEntry(prevBar, 100, 101);
    expect(d.triggered).toBe(false);
    expect(d.reachedTarget).toBe(false);
    expect(d.detail).toContain('미진입');
  });

  it('현재가 = 목표가 → 진입(경계 포함)', () => {
    const d = evaluateBreakoutEntry(prevBar, 100, 102);
    expect(d.reachedTarget).toBe(true);
    expect(d.triggered).toBe(true);
  });

  it('추세 필터 ON·필터 통과 → 진입', () => {
    const params = { ...DEFAULT_BREAKOUT_ENTRY_PARAMS, trendFilterEnabled: true };
    // closes: 전일 종가(100) > SMA([100,100,100,100,100])=100 → false
    // use closes where last > sma
    const closes = [90, 90, 90, 90, 100];
    const d = evaluateBreakoutEntry(prevBar, 100, 102, closes, params);
    expect(d.trendOk).toBe(true);
    expect(d.triggered).toBe(true);
  });

  it('추세 필터 ON·필터 실패 → 미진입(현재가 도달해도)', () => {
    const params = { ...DEFAULT_BREAKOUT_ENTRY_PARAMS, trendFilterEnabled: true };
    // closes: 마지막 값 = 전일 종가 < SMA
    const closes = [110, 110, 110, 110, 90];
    const d = evaluateBreakoutEntry(prevBar, 100, 102, closes, params);
    expect(d.trendOk).toBe(false);
    expect(d.triggered).toBe(false);
  });

  it('전일 데이터 결측 → insufficientData=true, 미진입', () => {
    const d = evaluateBreakoutEntry(null, 100, 105);
    expect(d.triggered).toBe(false);
    expect(d.insufficientData).toBe(true);
    expect(d.targetPrice).toBeNull();
  });

  it('Range=0(거래정지) → insufficientData=true, 미진입', () => {
    const d = evaluateBreakoutEntry(bar(100, 100, 100, 100), 100, 100);
    expect(d.triggered).toBe(false);
    expect(d.insufficientData).toBe(true);
  });

  it('sizingFactor가 결과에 포함된다', () => {
    // rangePct=4%, target=1% → factor=0.25
    const d = evaluateBreakoutEntry(prevBar, 100, 102);
    expect(d.sizingFactor).toBeCloseTo(0.25, 6);
  });
});
