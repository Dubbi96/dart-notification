/**
 * kst-intraday-session.spec.ts — DAR-423 인트라데이 세션 거래일(kstIntradaySessionDate)
 *
 * 모든 단정은 절대 시각(UTC 'Z') 입력 — Intl 이 Asia/Seoul 로만 환산하므로 시스템 TZ 무관.
 * KST = UTC+9 (DST 없음). 개장 09:00 KST = 00:00 UTC.
 * 기준일: 2026-06-19=금, 06-20=토, 06-21=일, 06-22=월, 06-23=화(오늘).
 *
 * 핵심: 장중/장마감후(평일·개장 이후)면 '오늘' YYYYMMDD, 장외(개장 전·주말)면 null.
 *   일봉 발행 미게시와 무관하게 '오늘 라이브 세션'을 거래일로 본다(버그 수정 본질).
 */

import { kstIntradaySessionDate } from './kst';

describe('DAR-423 — kstIntradaySessionDate (인트라데이 거래일)', () => {
  it('화 12:00(장중) → 오늘(20260623)', () => {
    // KST 화 12:00 = UTC 03:00
    expect(kstIntradaySessionDate(new Date('2026-06-23T03:00:00Z'))).toBe('20260623');
  });

  it('화 09:00(개장 경계) → 오늘(20260623)', () => {
    // KST 화 09:00 = UTC 00:00
    expect(kstIntradaySessionDate(new Date('2026-06-23T00:00:00Z'))).toBe('20260623');
  });

  it('화 16:00(장 마감 후, 같은 세션일) → 오늘(20260623)', () => {
    // KST 화 16:00 = UTC 07:00 — 일봉 미게시 시각이지만 인트라데이는 여전히 오늘
    expect(kstIntradaySessionDate(new Date('2026-06-23T07:00:00Z'))).toBe('20260623');
  });

  it('화 23:00(심야, 개장 이후) → 오늘(20260623)', () => {
    // KST 화 23:00 = UTC 14:00 — 평일 개장 이후 자정 전까지 오늘 유지
    expect(kstIntradaySessionDate(new Date('2026-06-23T14:00:00Z'))).toBe('20260623');
  });

  it('화 08:59(개장 직전·장외) → null', () => {
    // KST 화 08:59 = UTC 월 23:59 (UTC 날짜는 6/22지만 KST 날짜는 6/23 08:59)
    expect(kstIntradaySessionDate(new Date('2026-06-22T23:59:00Z'))).toBeNull();
  });

  it('화 00:00(새벽·장외) → null', () => {
    // KST 화 00:00 = UTC 월 15:00
    expect(kstIntradaySessionDate(new Date('2026-06-22T15:00:00Z'))).toBeNull();
  });

  it('토 12:00(주말) → null', () => {
    expect(kstIntradaySessionDate(new Date('2026-06-20T03:00:00Z'))).toBeNull();
  });

  it('일 12:00(주말) → null', () => {
    expect(kstIntradaySessionDate(new Date('2026-06-21T03:00:00Z'))).toBeNull();
  });

  it('월 09:00(평일 개장) → 오늘(20260622)', () => {
    expect(kstIntradaySessionDate(new Date('2026-06-22T00:00:00Z'))).toBe('20260622');
  });
});
