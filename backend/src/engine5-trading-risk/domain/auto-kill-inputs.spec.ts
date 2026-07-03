// Engine5 — 자동 킬스위치 입력 산출 순수 함수 테스트 (DAR-502 [견고화 W2·P20])
import {
  countConsecutiveLosses,
  computeMarketDropPct,
  SHADOW_AUTO_KILL_CONDITIONS,
} from './auto-kill-inputs';
import { DEFAULT_AUTO_KILL_CONDITIONS } from './risk-check.types';
import { checkAutoKill } from './kill-switch';

describe('countConsecutiveLosses (연속 손실 산출)', () => {
  it('빈 배열 → 0', () => {
    expect(countConsecutiveLosses([])).toBe(0);
  });

  it('최신부터 이어지는 손실만 카운트(첫 비손실에서 종료)', () => {
    // 최신(index0)부터 -,-,-,+,- → 앞 3개만
    expect(countConsecutiveLosses([-100, -50, -10, 200, -999])).toBe(3);
  });

  it('전부 손실이면 길이 전체', () => {
    expect(countConsecutiveLosses([-1, -2, -3, -4, -5])).toBe(5);
  });

  it('최신이 이익이면 0(스트릭 없음)', () => {
    expect(countConsecutiveLosses([10, -1, -2])).toBe(0);
  });

  it('브레이크이븐(0)은 손실 아님 → 스트릭 종료', () => {
    expect(countConsecutiveLosses([-1, -2, 0, -3])).toBe(2);
  });

  it('비유한값(NaN)은 스트릭 종료', () => {
    expect(countConsecutiveLosses([-1, NaN, -2])).toBe(1);
  });
});

describe('computeMarketDropPct (시장 급락율 산출)', () => {
  it('데이터 없음 → 0', () => {
    expect(computeMarketDropPct([])).toBe(0);
  });

  it('2행: 전일 종가 대비 당일 종가(일간 수익률)', () => {
    // 최신 종가 950, 전일 종가 1000 → -5%
    const pct = computeMarketDropPct([
      { closeIndex: 950, openIndex: 990 },
      { closeIndex: 1000, openIndex: 1000 },
    ]);
    expect(pct).toBeCloseTo(-0.05, 10);
  });

  it('1행: 당일 시가 대비 종가(장중 폴백)', () => {
    const pct = computeMarketDropPct([{ closeIndex: 900, openIndex: 1000 }]);
    expect(pct).toBeCloseTo(-0.1, 10);
  });

  it('전일 종가 ≤ 0 이면 0(분모 안전)', () => {
    expect(
      computeMarketDropPct([
        { closeIndex: 900, openIndex: 900 },
        { closeIndex: 0, openIndex: 0 },
      ]),
    ).toBe(0);
  });

  it('상승장이면 양수(급락 아님)', () => {
    const pct = computeMarketDropPct([
      { closeIndex: 1050, openIndex: 1000 },
      { closeIndex: 1000, openIndex: 1000 },
    ]);
    expect(pct).toBeCloseTo(0.05, 10);
  });
});

describe('SHADOW 계측 조건 = frozen DEFAULT (임계 무변경 — SHADOW 중립성)', () => {
  it('SHADOW_AUTO_KILL_CONDITIONS 은 DEFAULT_AUTO_KILL_CONDITIONS 와 값 동일', () => {
    expect(SHADOW_AUTO_KILL_CONDITIONS).toEqual(DEFAULT_AUTO_KILL_CONDITIONS);
  });

  it('산출 입력 → checkAutoKill 결선: 연속손실 5회면 CONSECUTIVE_LOSS 권고', () => {
    const inputs = {
      consecutiveLossCount: countConsecutiveLosses([-1, -2, -3, -4, -5]),
      marketDropPct: computeMarketDropPct([]),
      apiErrorCount: 0,
    };
    const advice = checkAutoKill(inputs, SHADOW_AUTO_KILL_CONDITIONS);
    expect(advice.shouldKill).toBe(true);
    expect(advice.triggerCode).toBe('CONSECUTIVE_LOSS');
  });

  it('정상 입력이면 권고 없음(shouldKill=false)', () => {
    const inputs = {
      consecutiveLossCount: countConsecutiveLosses([10, -1]),
      marketDropPct: computeMarketDropPct([
        { closeIndex: 1001, openIndex: 1000 },
        { closeIndex: 1000, openIndex: 1000 },
      ]),
      apiErrorCount: 0,
    };
    expect(checkAutoKill(inputs, SHADOW_AUTO_KILL_CONDITIONS).shouldKill).toBe(false);
  });
});
