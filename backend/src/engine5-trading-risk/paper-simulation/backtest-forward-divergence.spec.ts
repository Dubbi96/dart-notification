/**
 * backtest-forward-divergence.spec.ts — 괴리 산출 순수 함수 결정론 검증 (DAR-479)
 *
 * 트레이딩 행동 무접촉·AI 미개입의 순수 산술만 검증한다(고정 fixture → 고정 결과).
 */

import {
  buildStrategyDivergence,
  computeTradesPerMonth,
  spanDaysBetween,
  findMetric,
  DivergenceTrackMetrics,
  DIVERGENCE_EPSILON,
} from './backtest-forward-divergence';

// 실제 서비스가 쓰는 임계와 동일(backtest 20건 / forward 5건).
const BT_THRESHOLD = 20;
const FW_THRESHOLD = 5;

function track(overrides: Partial<DivergenceTrackMetrics>): DivergenceTrackMetrics {
  return {
    returnPct: 0,
    winRate: 0,
    avgHoldDays: 0,
    tradesPerMonth: 0,
    sampleSize: 0,
    ...overrides,
  };
}

function build(bt: DivergenceTrackMetrics, fw: DivergenceTrackMetrics) {
  return buildStrategyDivergence({
    key: 'event-edge',
    label: '이벤트 엣지',
    tagline: '테스트',
    backtest: bt,
    forward: fw,
    backtestLowSampleThreshold: BT_THRESHOLD,
    forwardLowSampleThreshold: FW_THRESHOLD,
  });
}

describe('computeTradesPerMonth', () => {
  it('tradeCount/spanDays × 30 을 소수 둘째자리로 환산한다', () => {
    // 12건 / 90일 × 30 = 4
    expect(computeTradesPerMonth(12, 90)).toBe(4);
    // 5건 / 30일 × 30 = 5
    expect(computeTradesPerMonth(5, 30)).toBe(5);
  });

  it('운용기간 0 이하면 null(0 나눗셈 방지)', () => {
    expect(computeTradesPerMonth(10, 0)).toBeNull();
    expect(computeTradesPerMonth(10, -5)).toBeNull();
  });

  it('거래 0건이면 0(null 아님)', () => {
    expect(computeTradesPerMonth(0, 30)).toBe(0);
  });
});

describe('spanDaysBetween', () => {
  it('포함 달력 일수(최소 1)를 계산한다', () => {
    expect(spanDaysBetween('20260101', '20260101')).toBe(1); // 같은 날 = 1
    expect(spanDaysBetween('20260101', '20260131')).toBe(31); // 1월 1~31 = 31일
    expect(spanDaysBetween('2026-01-01', '2026-01-11')).toBe(11); // 하이픈 허용
  });

  it('역전·미상 입력은 null', () => {
    expect(spanDaysBetween('20260131', '20260101')).toBeNull();
    expect(spanDaysBetween(null, '20260101')).toBeNull();
    expect(spanDaysBetween('20260101', null)).toBeNull();
    expect(spanDaysBetween('bad', '20260101')).toBeNull();
  });
});

describe('buildStrategyDivergence — 정렬(ALIGNED)', () => {
  const bt = track({ returnPct: 12, winRate: 0.55, avgHoldDays: 10, tradesPerMonth: 8, sampleSize: 30 });
  const fw = track({ returnPct: 14, winRate: 0.5, avgHoldDays: 11, tradesPerMonth: 9, sampleSize: 8 });
  const result = build(bt, fw);

  it('표본 충분·작은 괴리는 전부 ALIGNED, diverged=false', () => {
    expect(result.lowSample).toBe(false);
    expect(result.diverged).toBe(false);
    expect(result.metrics.map((m) => m.status)).toEqual(['ALIGNED', 'ALIGNED', 'ALIGNED', 'ALIGNED']);
  });

  it('gap = forward − backtest 로 계산된다', () => {
    expect(findMetric(result, 'return')?.gap).toBe(2);
    expect(findMetric(result, 'winRate')?.gap).toBeCloseTo(-0.05, 5);
    expect(findMetric(result, 'tradeFrequency')?.gap).toBe(1);
    expect(findMetric(result, 'holdDays')?.gap).toBe(1);
  });

  it('hasBacktest/hasForward true, 표본수 노출', () => {
    expect(result.hasBacktest).toBe(true);
    expect(result.hasForward).toBe(true);
    expect(result.backtestSampleSize).toBe(30);
    expect(result.forwardSampleSize).toBe(8);
  });
});

describe('buildStrategyDivergence — 괴리(DIVERGED)', () => {
  const bt = track({ returnPct: 12, winRate: 0.55, avgHoldDays: 10, tradesPerMonth: 8, sampleSize: 30 });
  const fw = track({ returnPct: 30, winRate: 0.3, avgHoldDays: 20, tradesPerMonth: 20, sampleSize: 10 });
  const result = build(bt, fw);

  it('표본 충분·큰 괴리는 전부 DIVERGED, diverged=true', () => {
    expect(result.lowSample).toBe(false);
    expect(result.diverged).toBe(true);
    expect(result.metrics.every((m) => m.status === 'DIVERGED')).toBe(true);
  });

  it('임계(ε) 경계: |gap| == ε 는 DIVERGED(미만만 ALIGNED)', () => {
    // return gap 정확히 ε(=5)
    const b = track({ returnPct: 10, winRate: 0.5, avgHoldDays: 10, tradesPerMonth: 8, sampleSize: 30 });
    const f = track({ returnPct: 15, winRate: 0.5, avgHoldDays: 10, tradesPerMonth: 8, sampleSize: 30 });
    const r = build(b, f);
    expect(findMetric(r, 'return')?.gap).toBe(DIVERGENCE_EPSILON.returnPct);
    expect(findMetric(r, 'return')?.status).toBe('DIVERGED');
    // 나머지 지표는 gap 0 → ALIGNED
    expect(findMetric(r, 'winRate')?.status).toBe('ALIGNED');
  });
});

describe('buildStrategyDivergence — 표본 부족(LOW_SAMPLE, 과신 방지)', () => {
  it('forward 표본 < 임계면 gap 은 산출하되 전부 LOW_SAMPLE·diverged=false', () => {
    const bt = track({ returnPct: 12, winRate: 0.55, avgHoldDays: 10, tradesPerMonth: 8, sampleSize: 30 });
    const fw = track({ returnPct: 40, winRate: 0.1, avgHoldDays: 30, tradesPerMonth: 30, sampleSize: 3 });
    const result = build(bt, fw);
    expect(result.lowSample).toBe(true);
    expect(result.diverged).toBe(false);
    expect(result.metrics.every((m) => m.status === 'LOW_SAMPLE')).toBe(true);
    // gap 은 참고용으로 여전히 산출
    expect(findMetric(result, 'return')?.gap).toBe(28);
  });

  it('backtest 표본 < 임계면 LOW_SAMPLE', () => {
    const bt = track({ returnPct: 12, winRate: 0.55, avgHoldDays: 10, tradesPerMonth: 8, sampleSize: 10 });
    const fw = track({ returnPct: 14, winRate: 0.5, avgHoldDays: 11, tradesPerMonth: 9, sampleSize: 8 });
    const result = build(bt, fw);
    expect(result.lowSample).toBe(true);
    expect(result.diverged).toBe(false);
  });
});

describe('buildStrategyDivergence — 한쪽 미산출(null)', () => {
  it('backtest 트랙 없음(값 null·표본 0)은 해당 지표 gap null·LOW_SAMPLE', () => {
    const bt = track({ returnPct: null, winRate: null, avgHoldDays: null, tradesPerMonth: null, sampleSize: 0 });
    const fw = track({ returnPct: 14, winRate: 0.5, avgHoldDays: 11, tradesPerMonth: 9, sampleSize: 8 });
    const result = build(bt, fw);
    expect(result.hasBacktest).toBe(false);
    expect(result.hasForward).toBe(true);
    expect(result.lowSample).toBe(true);
    const ret = findMetric(result, 'return');
    expect(ret?.gap).toBeNull();
    expect(ret?.status).toBe('LOW_SAMPLE');
    expect(ret?.reason).toContain('미산출');
  });

  it('forward 승률만 null 이면 해당 지표만 gap null', () => {
    const bt = track({ returnPct: 12, winRate: 0.55, avgHoldDays: 10, tradesPerMonth: 8, sampleSize: 30 });
    const fw = track({ returnPct: 14, winRate: null, avgHoldDays: 11, tradesPerMonth: 9, sampleSize: 8 });
    const result = build(bt, fw);
    expect(findMetric(result, 'winRate')?.gap).toBeNull();
    // 다른 지표는 정상 산출
    expect(findMetric(result, 'return')?.gap).toBe(2);
  });
});
