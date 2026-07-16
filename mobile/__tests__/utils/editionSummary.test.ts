import { editionDayGap, ymdToMonthDay } from '@utils/editionSummary';

// 홈 '최신 에디션 요약' 순수 파생 헬퍼 회귀 가드(DAR-508/517).
// 두 KST 거래일(YYYYMMDD) 문자열만 비교 — 디바이스 타임존·Date.now() 비의존(결정론).

describe('editionDayGap', () => {
  it('같은 날 → 0', () => {
    expect(editionDayGap('20260716', '20260716')).toBe(0);
  });

  it('연속 거래일(어제→오늘) → 1', () => {
    expect(editionDayGap('20260715', '20260716')).toBe(1);
  });

  it('주말 낀 간극(금 13일 → 월 16일) → 3', () => {
    expect(editionDayGap('20260713', '20260716')).toBe(3);
  });

  it('월 경계(6/30 → 7/2) → 2', () => {
    expect(editionDayGap('20260630', '20260702')).toBe(2);
  });

  it('연 경계(2025-12-31 → 2026-01-02) → 2', () => {
    expect(editionDayGap('20251231', '20260102')).toBe(2);
  });

  it('from 이 to 보다 미래면 음수(호출부가 >=1 로 게이팅)', () => {
    expect(editionDayGap('20260717', '20260716')).toBe(-1);
  });

  it('형식 불일치/결측 → null', () => {
    expect(editionDayGap('2026-07-16', '20260716')).toBeNull();
    expect(editionDayGap('20260716', undefined)).toBeNull();
    expect(editionDayGap(null, '20260716')).toBeNull();
    expect(editionDayGap('20260716', '')).toBeNull();
  });

  it('롤오버(존재하지 않는 날짜) → null', () => {
    expect(editionDayGap('20260230', '20260301')).toBeNull();
  });
});

describe('ymdToMonthDay', () => {
  it('앞자리 0 제거한 M/D 로 변환', () => {
    expect(ymdToMonthDay('20260715')).toBe('7/15');
    expect(ymdToMonthDay('20260101')).toBe('1/1');
    expect(ymdToMonthDay('20261231')).toBe('12/31');
  });

  it('형식 불일치/결측 → null', () => {
    expect(ymdToMonthDay('2026-07-15')).toBeNull();
    expect(ymdToMonthDay('')).toBeNull();
    expect(ymdToMonthDay(null)).toBeNull();
    expect(ymdToMonthDay(undefined)).toBeNull();
    expect(ymdToMonthDay('2026071')).toBeNull();
  });

  it('롤오버(존재하지 않는 날짜) → null', () => {
    expect(ymdToMonthDay('20260230')).toBeNull();
  });
});
