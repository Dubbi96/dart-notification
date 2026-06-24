// DAR-435 — minute-timestamp 유틸 결정론 검증(순수 함수).
//   특히 kstWallClockIso: naive-KST ts → `+09:00` 오프셋 명시 ISO(클라이언트 이중 오프셋 해소).

import {
  minuteTimestamp,
  hhmmFromTs,
  tradeDateFromTs,
  kstWallClockIso,
} from './minute-timestamp';

describe('minute-timestamp', () => {
  it('minuteTimestamp: KST HHMM 을 UTC 컴포넌트에 담은 naive instant', () => {
    const ts = minuteTimestamp('20260624', '1014');
    expect(ts).not.toBeNull();
    expect(ts!.getUTCHours()).toBe(10);
    expect(ts!.getUTCMinutes()).toBe(14);
    expect(ts!.getUTCSeconds()).toBe(0);
    expect(ts!.getUTCMilliseconds()).toBe(0);
  });

  it('minuteTimestamp: 형식 불량/비현실 시각이면 null', () => {
    expect(minuteTimestamp('2026062', '1014')).toBeNull();
    expect(minuteTimestamp('20260624', '99')).toBeNull();
    expect(minuteTimestamp('20260624', '2460')).toBeNull();
  });

  it('kstWallClockIso: naive-KST ts → +09:00 오프셋 ISO(이중 오프셋 방지)', () => {
    // naive 10:14(UTC 컴포넌트) = KST 벽시계 10:14 → `...T10:14:00+09:00`.
    const ts = minuteTimestamp('20260624', '1014')!;
    expect(kstWallClockIso(ts)).toBe('2026-06-24T10:14:00+09:00');
  });

  it('kstWallClockIso: toISOString(UTC Z)과 달리 +9 가 ISO 에 명시돼 클라이언트가 정확 instant 파싱', () => {
    const ts = minuteTimestamp('20260624', '0951')!;
    // 구버그: toISOString() → `...T09:51:00.000Z` (클라이언트 Asia/Seoul 변환 시 +9 중복 → 18:51).
    expect(ts.toISOString()).toBe('2026-06-24T09:51:00.000Z');
    // 신규: +09:00 명시 → new Date(iso) 가 09:51 KST 의 정확한 instant(00:51Z)로 파싱.
    const iso = kstWallClockIso(ts);
    expect(iso).toBe('2026-06-24T09:51:00+09:00');
    expect(new Date(iso).getTime()).toBe(Date.UTC(2026, 5, 24, 0, 51));
  });

  it('round-trip: minuteTimestamp ↔ hhmmFromTs/tradeDateFromTs', () => {
    const ts = minuteTimestamp('20260624', '1520')!;
    expect(hhmmFromTs(ts)).toBe('1520');
    expect(tradeDateFromTs(ts)).toBe('20260624');
  });
});
