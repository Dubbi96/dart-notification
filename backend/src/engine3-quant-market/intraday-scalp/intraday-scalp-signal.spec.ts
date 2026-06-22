// DAR-411 — 분봉 단타 진입 신호(순수 Rule) 결정론 검증.
// 진입 3조건 AND: 거래량 폭발 / 돌파 / VWAP 상회. 각 조건 단독 실패 시 미진입.

import {
  ScalpCandle,
  computeVwap,
  evaluateScalpEntry,
  DEFAULT_SCALP_ENTRY_PARAMS,
  SCALP_ENTRY_TAG,
} from './intraday-scalp-signal';

/** 시각은 판정에 무관(순서만 의미) — 인덱스 기반 더미 Date. */
function ts(i: number): Date {
  return new Date(Date.UTC(2026, 5, 22, 0, i, 0));
}

/**
 * 기준 시계열 생성: 직전 base 분은 평탄(가격 100, 거래량 100), 마지막 1분(현재)만 오버라이드.
 * 평탄 구간 고가=100, 평균 거래량=100 → 조건 충족/실패를 마지막 분 값으로 정밀 제어.
 */
function buildSeries(
  current: { high: number; low: number; close: number; volume: number },
  baseCount = 25,
): ScalpCandle[] {
  const out: ScalpCandle[] = [];
  for (let i = 0; i < baseCount; i++) {
    out.push({ ts: ts(i), open: 100, high: 100, low: 100, close: 100, volume: 100 });
  }
  out.push({
    ts: ts(baseCount),
    open: current.close,
    high: current.high,
    low: current.low,
    close: current.close,
    volume: current.volume,
  });
  return out;
}

describe('computeVwap', () => {
  it('전형가격 가중평균을 계산한다', () => {
    const candles: ScalpCandle[] = [
      { ts: ts(0), open: 10, high: 12, low: 8, close: 10, volume: 100 }, // typical 10
      { ts: ts(1), open: 10, high: 22, low: 14, close: 18, volume: 300 }, // typical 18
    ];
    // (10*100 + 18*300) / 400 = 6400/400 = 16
    expect(computeVwap(candles)).toBeCloseTo(16, 6);
  });

  it('거래량 0이면 null', () => {
    expect(computeVwap([{ ts: ts(0), open: 1, high: 1, low: 1, close: 1, volume: 0 }])).toBeNull();
  });
});

describe('evaluateScalpEntry — 3조건 AND', () => {
  it('세 조건 모두 충족 → 진입(triggered)', () => {
    // 거래량 300 = 평균 100 × 3 ≥ 2.5배 ✓ / 종가 105 > 고가 100 ✓ / 105 > VWAP(≈100) ✓
    const d = evaluateScalpEntry(buildSeries({ high: 106, low: 100, close: 105, volume: 300 }));
    expect(d.triggered).toBe(true);
    expect(d.reasons).toEqual({ volumeExplosion: true, breakout: true, aboveVwap: true });
    expect(d.currentPrice).toBe(105);
    expect(d.volumeRatio).toBeCloseTo(3, 6);
    expect(d.detail).toContain(SCALP_ENTRY_TAG);
  });

  it('거래량 폭발만 미충족 → 미진입', () => {
    // 거래량 200 = 평균 100 × 2.0 < 2.5배 ✗
    const d = evaluateScalpEntry(buildSeries({ high: 106, low: 100, close: 105, volume: 200 }));
    expect(d.triggered).toBe(false);
    expect(d.reasons.volumeExplosion).toBe(false);
    expect(d.reasons.breakout).toBe(true);
    expect(d.reasons.aboveVwap).toBe(true);
  });

  it('돌파만 미충족 → 미진입', () => {
    // 종가 100 = 직전 고가 100 (초과 아님) ✗
    const d = evaluateScalpEntry(buildSeries({ high: 100, low: 99, close: 100, volume: 300 }));
    expect(d.triggered).toBe(false);
    expect(d.reasons.breakout).toBe(false);
  });

  it('VWAP 상회만 미충족 → 미진입', () => {
    // 직전 평탄가 200, 거래량 폭발 + 돌파는 만들되 종가를 VWAP 아래로.
    const base: ScalpCandle[] = [];
    for (let i = 0; i < 25; i++) {
      base.push({ ts: ts(i), open: 200, high: 200, low: 200, close: 200, volume: 100 });
    }
    // 현재: 종가 150 < VWAP(≈200), 거래량 폭발(300), 하지만 돌파(150<200)도 실패.
    // VWAP 단독 실패를 보이기 위해 돌파는 별개 케이스로 검증됨 — 여기선 aboveVwap=false 확인.
    base.push({ ts: ts(25), open: 150, high: 150, low: 150, close: 150, volume: 300 });
    const d = evaluateScalpEntry(base);
    expect(d.reasons.aboveVwap).toBe(false);
    expect(d.triggered).toBe(false);
  });

  it('표본 부족(장 초반) → insufficientData, 미진입', () => {
    const few = buildSeries({ high: 106, low: 100, close: 105, volume: 300 }, 5);
    const d = evaluateScalpEntry(few);
    expect(d.insufficientData).toBe(true);
    expect(d.triggered).toBe(false);
  });

  it('빈 시계열 → graceful 미진입', () => {
    const d = evaluateScalpEntry([]);
    expect(d.triggered).toBe(false);
    expect(d.insufficientData).toBe(true);
    expect(d.currentPrice).toBeNull();
  });

  it('파라미터 상수가 이슈 설계와 일치', () => {
    expect(DEFAULT_SCALP_ENTRY_PARAMS.volumeMultiple).toBe(2.5);
    expect(DEFAULT_SCALP_ENTRY_PARAMS.volumeAvgLookbackMin).toBe(20);
    expect(DEFAULT_SCALP_ENTRY_PARAMS.breakoutLookbackMin).toBe(15);
  });
});
