// DAR-411 — 분봉 단타 청산 판정(순수 Rule) 결정론 검증.
// 익절 +2% / 손절 -1.2% / 15:20 전량 강제청산(당일 청산 보장).

import {
  evaluateScalpExit,
  isForceExitTime,
  isPastEntryCutoff,
  TAKE_PROFIT_PCT,
  STOP_LOSS_PCT,
  FORCE_EXIT_HHMM,
} from './intraday-scalp-exit';

describe('evaluateScalpExit', () => {
  it('익절: +2% 도달 시 TAKE_PROFIT', () => {
    const d = evaluateScalpExit(1000, 1020, '1000');
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('TAKE_PROFIT');
    expect(d.returnPct).toBeCloseTo(2.0, 6);
  });

  it('손절: -1.2% 도달 시 STOP_LOSS', () => {
    const d = evaluateScalpExit(1000, 988, '1000');
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('STOP_LOSS');
    expect(d.returnPct).toBeCloseTo(-1.2, 6);
  });

  it('익절/손절 미도달 → 보유 유지', () => {
    const d = evaluateScalpExit(1000, 1010, '1000'); // +1.0%
    expect(d.shouldExit).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('15:20 강제청산은 손익 무관 최우선 — 미달 수익률이어도 청산', () => {
    const d = evaluateScalpExit(1000, 1005, '1520'); // +0.5%, 임계 미달
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('FORCE_CLOSE_EOD');
  });

  it('15:20 강제청산은 손실 포지션도 무조건 청산(오버나잇 금지)', () => {
    const d = evaluateScalpExit(1000, 995, '1521'); // -0.5%, 손절 임계 미달
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('FORCE_CLOSE_EOD');
  });

  it('15:19 까지는 강제청산 아님(임계 도달 시에만 청산)', () => {
    const d = evaluateScalpExit(1000, 1005, '1519'); // +0.5%
    expect(d.shouldExit).toBe(false);
  });
});

describe('시각 게이트', () => {
  it('isForceExitTime: 15:20 포함 이후 true', () => {
    expect(isForceExitTime('1519')).toBe(false);
    expect(isForceExitTime('1520')).toBe(true);
    expect(isForceExitTime('1530')).toBe(true);
  });

  it('isPastEntryCutoff: 15:20 이후 신규 진입 금지', () => {
    expect(isPastEntryCutoff('1519')).toBe(false);
    expect(isPastEntryCutoff('1520')).toBe(true);
  });

  it('상수가 이슈 설계와 일치', () => {
    expect(TAKE_PROFIT_PCT).toBe(2.0);
    expect(STOP_LOSS_PCT).toBe(-1.2);
    expect(FORCE_EXIT_HHMM).toBe('1520');
  });
});
