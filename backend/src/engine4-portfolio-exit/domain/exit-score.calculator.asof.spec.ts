/**
 * exit-score.calculator.asof.spec.ts — 보유일 계산 평가일(asOf) 주입 계약 (fix/exit-score-asof-clock)
 *
 * 검증:
 *   1) tradingDaysSince(entryDate, asOf) — 주입 asOf 기준 결정적(벽시계 비의존), countTradingDays 동치.
 *   2) tradingDaysSince(entryDate) — 미전달 시 기본값 new Date()(라이브 동작 보존).
 *   3) calculateExitScore(..., asOf) — 과거 asOf 주입 시 시간초과 트리거 억제,
 *      미전달(기본 new Date())과 명시 asOf=new Date() 동치(라이브 무변경 증명).
 *
 * ★AI 금지영역 불가침: 순수 Rule 계산 — AI 미개입.
 */

import {
  calculateExitScore,
  countTradingDays,
  tradingDaysSince,
} from './exit-score.calculator';
import { PositionSnapshot, TechnicalSnapshot } from './exit-engine.types';

const ENTRY = new Date('2026-06-10T00:00:00Z'); // 수(dow=3)
const AS_OF_NEAR = new Date('2026-06-19T03:00:00Z'); // 진입 +7 거래일
const NOW_FAR = new Date('2026-08-01T00:00:00Z'); // 진입 +37 거래일

/** 손실·차트·공시 트리거가 0 이 되도록 중립 스냅샷(시간초과만 분리 관찰). */
function neutralPos(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: 'p1',
    corpCode: '00126380',
    stockCode: '005930',
    entryPrice: 10000,
    quantity: 10,
    entryAmount: 100000,
    currentPrice: 10000,
    highestPrice: 10000,
    stopLossPct: null,
    takeProfitPct: null,
    maxHoldDays: 20,
    entryDate: ENTRY,
    portfolioTotalValue: 1_000_000,
    portfolioMaxSinglePositionPct: 10,
    portfolioMaxSectorPct: 30,
    portfolioMaxDailyLossPct: 2,
    portfolioDailyLossPct: null,
    ...overrides,
  };
}

const NEUTRAL_TECH: TechnicalSnapshot = {
  closePrice: 10000,
  openPrice: null,
  ma5: null,
  ma20: null,
  low20: null,
  vwap: null,
  atr14: null,
  volumeRatio3d: null,
  excessReturn5d: null,
  avgVolumeRatio5d: null,
};

describe('tradingDaysSince(asOf) — 평가일 주입 결정성', () => {
  it('주입 asOf 기준으로 결정적(벽시계 비의존) + countTradingDays 동치', () => {
    expect(tradingDaysSince(ENTRY, AS_OF_NEAR)).toBe(7);
    expect(tradingDaysSince(ENTRY, AS_OF_NEAR)).toBe(
      countTradingDays(ENTRY, AS_OF_NEAR),
    );
    // 더 이른 asOf → 더 작은 보유일(단조).
    expect(tradingDaysSince(ENTRY, new Date('2026-06-15T00:00:00Z'))).toBe(3);
    expect(tradingDaysSince(ENTRY, AS_OF_NEAR)).toBeLessThan(
      tradingDaysSince(ENTRY, NOW_FAR),
    );
  });

  describe('기본값 = new Date() (라이브 동작 보존)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW_FAR);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('asOf 미전달 → new Date()(고정 시스템시각)로 계산, 명시 asOf=now 와 동치', () => {
      expect(tradingDaysSince(ENTRY)).toBe(37);
      expect(tradingDaysSince(ENTRY)).toBe(tradingDaysSince(ENTRY, NOW_FAR));
      // 과거 asOf 주입은 기본값보다 작다(룩어헤드 차단).
      expect(tradingDaysSince(ENTRY, AS_OF_NEAR)).toBeLessThan(
        tradingDaysSince(ENTRY),
      );
    });
  });
});

describe('calculateExitScore(asOf) — 시간초과 트리거 억제 vs 기본값 동치', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW_FAR); // 벽시계 = 진입 +37 거래일(maxHoldDays 20 초과)
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('과거 asOf(진입 +7일) 주입 → 시간초과 미발화(timeExceededScore 0·TIME_LIMIT 없음·score 0)', () => {
    const r = calculateExitScore(
      neutralPos(),
      NEUTRAL_TECH,
      null,
      [],
      null,
      AS_OF_NEAR,
    );
    expect(r.components.timeExceededScore).toBe(0);
    expect(r.triggerTypes).not.toContain('TIME_LIMIT');
    expect(r.exitScore).toBe(0);
    expect(r.exitAction).toBe('HOLD');
  });

  it('asOf 미전달(기본 new Date()) → 시간초과 발화, 명시 asOf=now 와 완전 동치(라이브 무변경)', () => {
    const dflt = calculateExitScore(neutralPos(), NEUTRAL_TECH, null, []);
    const explicit = calculateExitScore(
      neutralPos(),
      NEUTRAL_TECH,
      null,
      [],
      null,
      NOW_FAR,
    );
    // 기본값이 곧 new Date() 임을 증명(동치).
    expect(dflt).toEqual(explicit);
    // 벽시계상 maxHoldDays(20) 초과 → 시간초과 +8, TIME_LIMIT 트리거.
    expect(dflt.components.timeExceededScore).toBe(8);
    expect(dflt.triggerTypes).toContain('TIME_LIMIT');
    expect(dflt.exitScore).toBe(8);
  });
});
