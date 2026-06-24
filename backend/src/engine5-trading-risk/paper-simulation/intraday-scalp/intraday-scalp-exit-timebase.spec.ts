// DAR-444 — 분봉 단타 청산 ts 불변식 가드레일(sealScalpExitTimebase) 결정론 검증.
//   장외(00~06시)·역전(exitTs<entryTs) 입력이 영속되지 않도록 장중 경계로 clamp 되는지 봉인.

import { sealScalpExitTimebase } from './intraday-scalp-exit';

const TRADE_DATE = '20260622'; // 월요일

/** 분봉 naive-KST instant(minuteTimestamp 규약: KST 벽시계를 UTC 컴포넌트에 담음). */
function kstNaive(hhmm: string): Date {
  const hh = Number(hhmm.slice(0, 2));
  const mm = Number(hhmm.slice(2, 4));
  return new Date(Date.UTC(2026, 5, 22, hh, mm));
}

/** 진짜 UTC instant(= timebase 회귀 시 closePosition 이 폴백하는 new Date 류). */
function realInstant(iso: string): Date {
  return new Date(iso);
}

describe('sealScalpExitTimebase (DAR-444 청산 ts 가드레일)', () => {
  it('정상: entryTs 이후·장중 naive-KST exitTs 는 보정 없이 통과', () => {
    const entryTs = kstNaive('0951');
    const candidate = kstNaive('1022'); // 10:22 장중·진입 이후
    const r = sealScalpExitTimebase(entryTs, candidate, TRADE_DATE);
    expect(r.clamped).toBe(false);
    expect(r.violation).toBeNull();
    expect(r.exitTs).toEqual(kstNaive('1022'));
    expect(r.holdMinutes).toBe(31); // 10:22 − 09:51
  });

  it('역전(exitTs<entryTs): 하한(entryTs)으로 clamp + holdMinutes=0 + violation', () => {
    const entryTs = kstNaive('1000');
    const candidate = kstNaive('0930'); // 진입보다 이른 시각
    const r = sealScalpExitTimebase(entryTs, candidate, TRADE_DATE);
    expect(r.clamped).toBe(true);
    expect(r.violation).toContain('하한');
    expect(r.exitTs).toEqual(entryTs); // entryTs 로 봉인
    expect(r.holdMinutes).toBe(0);
    expect(r.exitTs.getTime()).toBeGreaterThanOrEqual(entryTs.getTime());
  });

  it('장외-전(00~06시 = 실-UTC now 폴백): 하한(entryTs)으로 clamp', () => {
    // closePosition 이 minuteTimestamp 파싱 실패로 `now`(진짜 UTC instant)를 폴백한 회귀 상황.
    // KST 10:22 의 진짜 instant = UTC 01:22Z → naive 비교에서 entryTs(naive 09:51)보다 9h 뒤(작음).
    const entryTs = kstNaive('0951');
    const candidate = realInstant('2026-06-22T10:22:00+09:00'); // = 2026-06-22T01:22:00Z
    const r = sealScalpExitTimebase(entryTs, candidate, TRADE_DATE);
    expect(r.clamped).toBe(true);
    expect(r.exitTs).toEqual(entryTs);
    expect(r.holdMinutes).toBe(0);
    // 봉인된 exitTs 는 반드시 장중(UTC 컴포넌트 = KST 벽시계 09:51).
    expect(r.exitTs.getUTCHours()).toBe(9);
  });

  it('장외-후(15:30 초과): 장마감(15:30) 경계로 clamp', () => {
    const entryTs = kstNaive('1500');
    const candidate = kstNaive('1645'); // 16:45 장마감 후
    const r = sealScalpExitTimebase(entryTs, candidate, TRADE_DATE);
    expect(r.clamped).toBe(true);
    expect(r.violation).toContain('장마감');
    expect(r.exitTs).toEqual(kstNaive('1530'));
    expect(r.holdMinutes).toBe(30); // 15:30 − 15:00
  });

  it('경계 포함: 정확히 09:00·15:30 은 장중으로 통과', () => {
    const open = sealScalpExitTimebase(kstNaive('0900'), kstNaive('1530'), TRADE_DATE);
    expect(open.clamped).toBe(false);
    expect(open.exitTs).toEqual(kstNaive('1530'));
  });

  it('봉인 후 불변식: 어떤 입력이든 exitTs 는 entryTs 이후·장중(09:00~15:30)·holdMinutes≥0', () => {
    const entryTs = kstNaive('1010');
    const candidates = [
      kstNaive('0000'), // 자정
      kstNaive('0100'), // 01시(신고된 버그 시각)
      kstNaive('0600'), // 06시
      realInstant('2026-06-22T11:00:00+09:00'), // 실-UTC 폴백
      kstNaive('2359'), // 장 마감 한참 후
      kstNaive('1015'), // 정상
    ];
    for (const c of candidates) {
      const r = sealScalpExitTimebase(entryTs, c, TRADE_DATE);
      const exitMinOfDay = r.exitTs.getUTCHours() * 60 + r.exitTs.getUTCMinutes();
      expect(exitMinOfDay).toBeGreaterThanOrEqual(9 * 60); // ≥ 09:00
      expect(exitMinOfDay).toBeLessThanOrEqual(15 * 60 + 30); // ≤ 15:30
      expect(r.exitTs.getTime()).toBeGreaterThanOrEqual(entryTs.getTime());
      expect(r.holdMinutes).toBeGreaterThanOrEqual(0);
    }
  });
});
