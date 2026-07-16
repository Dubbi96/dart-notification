import {
  editionDateLabel,
  editionDateA11yLabel,
  isTodayKst,
  buildEditionTitle,
} from '@utils/signalTerms';

// KST(+9h) 달력일 기준 날짜 포맷·'오늘' 판정·에디션 헤더 생성 회귀 가드 (DAR-504).
// now 주입으로 결정론 — 디바이스 타임존·Date.now() 비의존.

// 2026-07-16 00:30:00 UTC = 2026-07-16 09:30:00 KST (오늘 기준 'now')
const NOW_KST_2026_07_16 = new Date('2026-07-16T00:30:00Z').getTime();

describe('editionDateLabel', () => {
  it('UTC ISO를 KST M/D로 변환한다', () => {
    expect(editionDateLabel('2026-07-14T09:00:00.000Z')).toBe('7/14');
  });

  it('KST 자정 경계: UTC 14일 15:00 → KST 15일 00:00', () => {
    expect(editionDateLabel('2026-07-14T15:00:00.000Z')).toBe('7/15');
  });

  it('null 입력 → null', () => {
    expect(editionDateLabel(null)).toBeNull();
  });

  it('undefined 입력 → null', () => {
    expect(editionDateLabel(undefined)).toBeNull();
  });

  it('빈 문자열 → null', () => {
    expect(editionDateLabel('')).toBeNull();
  });

  it('파싱 불가 문자열 → null', () => {
    expect(editionDateLabel('not-a-date')).toBeNull();
  });
});

describe('editionDateA11yLabel', () => {
  it('UTC ISO를 KST M월 D일로 변환한다', () => {
    expect(editionDateA11yLabel('2026-07-14T09:00:00.000Z')).toBe('7월 14일');
  });

  it('null → null', () => {
    expect(editionDateA11yLabel(null)).toBeNull();
  });
});

describe('isTodayKst', () => {
  it('같은 KST 달력일이면 true', () => {
    // iso: 2026-07-16 KST, now: 2026-07-16 KST
    expect(isTodayKst('2026-07-16T00:30:00.000Z', NOW_KST_2026_07_16)).toBe(true);
  });

  it('다른 KST 달력일이면 false', () => {
    // iso: 2026-07-14 KST, now: 2026-07-16 KST
    expect(isTodayKst('2026-07-14T09:00:00.000Z', NOW_KST_2026_07_16)).toBe(false);
  });

  it('null iso → false(오늘 단정 금지)', () => {
    expect(isTodayKst(null, NOW_KST_2026_07_16)).toBe(false);
  });

  it('undefined iso → false', () => {
    expect(isTodayKst(undefined, NOW_KST_2026_07_16)).toBe(false);
  });

  it('파싱 불가 → false', () => {
    expect(isTodayKst('invalid', NOW_KST_2026_07_16)).toBe(false);
  });

  it('KST 자정 경계: UTC 14일 14:59(KST 14일 23:59) ≠ UTC 14일 15:00(KST 15일 00:00)', () => {
    const justBefore = new Date('2026-07-14T14:59:59Z').getTime();
    const justAfter = new Date('2026-07-14T15:00:00Z').getTime();
    expect(isTodayKst('2026-07-14T14:59:59Z', justBefore)).toBe(true);
    expect(isTodayKst('2026-07-14T14:59:59Z', justAfter)).toBe(false);
  });
});

describe('buildEditionTitle', () => {
  it('isToday=true → 오늘의 투자판단', () => {
    expect(buildEditionTitle('2026-07-16T00:30:00.000Z', true, NOW_KST_2026_07_16)).toBe(
      '오늘의 투자판단',
    );
  });

  it('isToday=false, 어제(1일 전) → 최신 투자판단 · M/D (N일 전 병기 없음)', () => {
    // now: 2026-07-16 KST, iso: 2026-07-15 KST (1일 gap)
    const iso = '2026-07-15T00:30:00.000Z'; // KST 07-15
    expect(buildEditionTitle(iso, false, NOW_KST_2026_07_16)).toBe('최신 투자판단 · 7/15');
  });

  it('isToday=false, 2일 전 → 최신 투자판단 · M/D · N일 전', () => {
    // now: 2026-07-16 KST, iso: 2026-07-14 KST (2일 gap)
    expect(buildEditionTitle('2026-07-14T09:00:00.000Z', false, NOW_KST_2026_07_16)).toBe(
      '최신 투자판단 · 7/14 · 2일 전',
    );
  });

  it('isToday=false, 14일 전 → 최신 투자판단 · M/D · 14일 전', () => {
    const iso14dAgo = new Date(NOW_KST_2026_07_16 - 14 * 24 * 60 * 60 * 1000).toISOString();
    const result = buildEditionTitle(iso14dAgo, false, NOW_KST_2026_07_16);
    expect(result).toContain('14일 전');
    expect(result).toContain('최신 투자판단');
  });

  it('latestCreatedAtISO=null → 날짜 단정 없는 우산 헤더 투자판단', () => {
    expect(buildEditionTitle(null, false, NOW_KST_2026_07_16)).toBe('투자판단');
  });

  it('latestCreatedAtISO=undefined → 투자판단', () => {
    expect(buildEditionTitle(undefined, false, NOW_KST_2026_07_16)).toBe('투자판단');
  });

  it('파싱 불가 → 투자판단', () => {
    expect(buildEditionTitle('bad-date', false, NOW_KST_2026_07_16)).toBe('투자판단');
  });
});
