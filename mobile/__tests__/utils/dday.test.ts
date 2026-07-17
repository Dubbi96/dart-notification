// DAR-538: D-day 표기 유틸 테스트 — 예정 이벤트 캘린더 칩/a11y 표기 SSOT

import { formatDday, ddayA11yLabel, isImminentDday, ymdToKoreanMonthDay } from '../../utils/dday';

describe('formatDday', () => {
  it('0은 D-Day, 양수는 D-N, 음수는 D+N', () => {
    expect(formatDday(0)).toBe('D-Day');
    expect(formatDday(1)).toBe('D-1');
    expect(formatDday(30)).toBe('D-30');
    expect(formatDday(-2)).toBe('D+2');
  });

  it('비정상 입력(NaN·Infinity)은 빈 문자열', () => {
    expect(formatDday(NaN)).toBe('');
    expect(formatDday(Infinity)).toBe('');
  });
});

describe('ddayA11yLabel', () => {
  it('스크린리더 자연어 표기', () => {
    expect(ddayA11yLabel(0)).toBe('오늘');
    expect(ddayA11yLabel(3)).toBe('3일 후');
    expect(ddayA11yLabel(-1)).toBe('1일 지남');
    expect(ddayA11yLabel(NaN)).toBe('');
  });
});

describe('isImminentDday', () => {
  it('오늘~3일 내만 임박', () => {
    expect(isImminentDday(0)).toBe(true);
    expect(isImminentDday(3)).toBe(true);
    expect(isImminentDday(4)).toBe(false);
    expect(isImminentDday(-1)).toBe(false);
    expect(isImminentDday(NaN)).toBe(false);
  });
});

describe('ymdToKoreanMonthDay', () => {
  it('YYYY-MM-DD → N월 N일 (0패딩 제거)', () => {
    expect(ymdToKoreanMonthDay('2026-08-03')).toBe('8월 3일');
    expect(ymdToKoreanMonthDay('2026-12-25')).toBe('12월 25일');
  });

  it('형식 불일치·결측은 null — 발명 금지', () => {
    expect(ymdToKoreanMonthDay('2026.08.03')).toBeNull();
    expect(ymdToKoreanMonthDay('20260803')).toBeNull();
    expect(ymdToKoreanMonthDay('')).toBeNull();
    expect(ymdToKoreanMonthDay(null)).toBeNull();
    expect(ymdToKoreanMonthDay(undefined)).toBeNull();
  });
});
