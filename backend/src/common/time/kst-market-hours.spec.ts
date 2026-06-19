/**
 * kst-market-hours.spec.ts — DAR-366 정규장 시간대 게이트(isKstRegularMarketHours)
 *
 * 모든 단정은 절대 시각(UTC 'Z') 입력 — Intl 이 Asia/Seoul 로만 환산하므로 시스템 TZ 무관.
 * KST = UTC+9 (DST 없음). 정규장 09:00~15:30 KST = 00:00~06:30 UTC.
 * 기준일: 2026-06-19=금, 06-20=토, 06-21=일, 06-22=월.
 */

import { isKstRegularMarketHours, kstClock, KRX_REGULAR_OPEN_MIN, KRX_REGULAR_CLOSE_MIN } from './kst';

describe('DAR-366 — isKstRegularMarketHours (평일 09:00~15:30 KST)', () => {
  it('상수: 09:00=540, 15:30=930', () => {
    expect(KRX_REGULAR_OPEN_MIN).toBe(540);
    expect(KRX_REGULAR_CLOSE_MIN).toBe(930);
  });

  it('kstClock 은 KST 벽시계 요일·분을 시스템 TZ 무관하게 추출', () => {
    // UTC 2026-06-19T00:00Z = KST 금 09:00
    expect(kstClock(new Date('2026-06-19T00:00:00Z'))).toEqual({ weekday: 'Fri', minutes: 540 });
    // UTC 2026-06-18T23:59Z = KST 금 08:59 (UTC는 목요일이지만 KST는 금요일 08:59)
    expect(kstClock(new Date('2026-06-18T23:59:00Z'))).toEqual({ weekday: 'Fri', minutes: 539 });
  });

  it('금 09:00(개장 경계) → true', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-19T00:00:00Z'))).toBe(true);
  });

  it('금 15:30(종료 경계 포함) → true', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-19T06:30:00Z'))).toBe(true);
  });

  it('금 15:31(종료 직후) → false', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-19T06:31:00Z'))).toBe(false);
  });

  it('금 08:59(개장 직전) → false', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-18T23:59:00Z'))).toBe(false);
  });

  it('금 12:00(장중) → true', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-19T03:00:00Z'))).toBe(true);
  });

  it('금 19:30(일배치 시각=장외) → false', () => {
    // KST 금 19:30 = UTC 10:30
    expect(isKstRegularMarketHours(new Date('2026-06-19T10:30:00Z'))).toBe(false);
  });

  it('토 12:00(주말) → false', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-20T03:00:00Z'))).toBe(false);
  });

  it('일 12:00(주말) → false', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-21T03:00:00Z'))).toBe(false);
  });

  it('월 09:00(평일 개장) → true', () => {
    expect(isKstRegularMarketHours(new Date('2026-06-22T00:00:00Z'))).toBe(true);
  });
});
