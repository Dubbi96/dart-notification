import {
  assertStrategyActivationWindow,
  assertValidStrategyActivationSchedule,
} from './strategy-activation-policy';

describe('strategy activation policy', () => {
  it('accepts a verified KRX trading day only after the regular close', () => {
    const result = assertStrategyActivationWindow(
      new Date('2026-07-31T06:31:00.000Z'), // 금요일 15:31 KST
    );

    expect(result).toEqual({
      marketSessionDate: '20260731',
      closeMinute: 930,
      currentMinute: 931,
    });
  });

  it('rejects the exact close minute and an intraday time', () => {
    expect(() => assertStrategyActivationWindow(new Date('2026-07-31T06:30:59.000Z'))).toThrow(
      expect.objectContaining({ code: 'ACTIVATION_NOT_AFTER_MARKET_CLOSE' }),
    );
    expect(() => assertStrategyActivationWindow(new Date('2026-07-31T05:00:00.000Z'))).toThrow(
      expect.objectContaining({ code: 'ACTIVATION_NOT_AFTER_MARKET_CLOSE' }),
    );
  });

  it.each([
    ['2026-08-01T10:00:00.000Z', '주말'],
    ['2026-08-17T10:00:00.000Z', 'KRX 대체공휴일'],
  ])('%s %s에는 활성화를 거부한다', (iso) => {
    expect(() => assertStrategyActivationWindow(new Date(iso))).toThrow(
      expect.objectContaining({ code: 'ACTIVATION_NOT_TRADING_DAY' }),
    );
  });

  it('uses the delayed close on the CSAT session override', () => {
    expect(
      () => assertStrategyActivationWindow(new Date('2026-11-19T07:00:00.000Z')), // 16:00 KST
    ).toThrow(expect.objectContaining({ code: 'ACTIVATION_NOT_AFTER_MARKET_CLOSE' }));

    expect(assertStrategyActivationWindow(new Date('2026-11-19T07:31:00.000Z'))).toEqual({
      marketSessionDate: '20261119',
      closeMinute: 990,
      currentMinute: 991,
    });
  });

  it('fails closed when the annual KRX calendar is not fully verified', () => {
    expect(() => assertStrategyActivationWindow(new Date('2027-01-04T10:00:00.000Z'))).toThrow(
      expect.objectContaining({ code: 'MARKET_CALENDAR_NOT_VERIFIED' }),
    );
  });

  it('requires a future, after-close trading timestamp for scheduling', () => {
    const requestedAt = new Date('2026-07-31T07:00:00.000Z');

    expect(() =>
      assertValidStrategyActivationSchedule(new Date('2026-08-03T05:00:00.000Z'), requestedAt),
    ).toThrow(expect.objectContaining({ code: 'ACTIVATION_NOT_AFTER_MARKET_CLOSE' }));
    expect(() => assertValidStrategyActivationSchedule(requestedAt, requestedAt)).toThrow(
      expect.objectContaining({ code: 'EFFECTIVE_FROM_NOT_FUTURE' }),
    );

    expect(
      assertValidStrategyActivationSchedule(new Date('2026-08-03T10:00:00.000Z'), requestedAt)
        .marketSessionDate,
    ).toBe('20260803');
  });
});
