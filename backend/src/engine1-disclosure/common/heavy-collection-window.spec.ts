// backend/src/engine1-disclosure/common/heavy-collection-window.spec.ts
// DAR-503: 헤비 수집 창 게이트 — 요일 경계·심야 창·env 오버라이드 결정론 스펙.
// ★TZ 무관: 모든 시각은 UTC 리터럴로 주입하고 KST 벽시계로 판정된다(Intl 고정).

import {
  DEFAULT_HEAVY_COLLECTION_WINDOW_MODE,
  HEAVY_NIGHT_WINDOW_END_MIN,
  isHeavyCollectionWindow,
  resolveHeavyCollectionWindowMode,
} from './heavy-collection-window';

// KST 벽시계 기준 대표 시각(위 UTC→KST 매핑은 kst 스펙과 동일 방식).
const FRI_MIDDAY = new Date('2026-07-03T03:00:00Z'); // KST 금 12:00
const SAT_MIDDAY = new Date('2026-07-04T03:00:00Z'); // KST 토 12:00
const SUN_MIDDAY = new Date('2026-07-05T03:00:00Z'); // KST 일 12:00
const MON_MIDDAY = new Date('2026-07-06T03:00:00Z'); // KST 월 12:00
const MON_NIGHT_0300 = new Date('2026-07-05T18:00:00Z'); // KST 월 03:00(심야)
const MON_0630 = new Date('2026-07-05T21:30:00Z'); // KST 월 06:30(심야 경계)
const MON_0700 = new Date('2026-07-05T22:00:00Z'); // KST 월 07:00(심야 밖)

describe('resolveHeavyCollectionWindowMode (DAR-503)', () => {
  it('유효값은 그대로 해석', () => {
    expect(resolveHeavyCollectionWindowMode('weekend')).toBe('weekend');
    expect(resolveHeavyCollectionWindowMode('always')).toBe('always');
    expect(resolveHeavyCollectionWindowMode('weekend+night')).toBe(
      'weekend+night',
    );
  });

  it('미설정·오인값은 기본(weekend)으로 폴백', () => {
    expect(resolveHeavyCollectionWindowMode(undefined)).toBe('weekend');
    expect(resolveHeavyCollectionWindowMode(null)).toBe('weekend');
    expect(resolveHeavyCollectionWindowMode('')).toBe('weekend');
    expect(resolveHeavyCollectionWindowMode('WEEKEND')).toBe('weekend'); // 대소문자 엄격
    expect(resolveHeavyCollectionWindowMode('nightly')).toBe('weekend');
    expect(DEFAULT_HEAVY_COLLECTION_WINDOW_MODE).toBe('weekend');
  });
});

describe('isHeavyCollectionWindow — weekend(기본)', () => {
  const mode = 'weekend' as const;

  it('토·일은 헤비 창(true)', () => {
    expect(isHeavyCollectionWindow(SAT_MIDDAY, mode)).toBe(true);
    expect(isHeavyCollectionWindow(SUN_MIDDAY, mode)).toBe(true);
  });

  it('주중(월~금)은 헤비 창 아님(false) — 심야여도 false', () => {
    expect(isHeavyCollectionWindow(FRI_MIDDAY, mode)).toBe(false);
    expect(isHeavyCollectionWindow(MON_MIDDAY, mode)).toBe(false);
    expect(isHeavyCollectionWindow(MON_NIGHT_0300, mode)).toBe(false);
  });
});

describe('isHeavyCollectionWindow — always(오버라이드)', () => {
  const mode = 'always' as const;

  it('요일·시각 무관 항상 true', () => {
    expect(isHeavyCollectionWindow(MON_MIDDAY, mode)).toBe(true);
    expect(isHeavyCollectionWindow(FRI_MIDDAY, mode)).toBe(true);
    expect(isHeavyCollectionWindow(SAT_MIDDAY, mode)).toBe(true);
    expect(isHeavyCollectionWindow(MON_0700, mode)).toBe(true);
  });
});

describe('isHeavyCollectionWindow — weekend+night(옵트인)', () => {
  const mode = 'weekend+night' as const;

  it('주말은 그대로 true', () => {
    expect(isHeavyCollectionWindow(SAT_MIDDAY, mode)).toBe(true);
    expect(isHeavyCollectionWindow(SUN_MIDDAY, mode)).toBe(true);
  });

  it('주중 심야(00:00~06:30 KST)는 true, 06:30 경계 포함', () => {
    expect(isHeavyCollectionWindow(MON_NIGHT_0300, mode)).toBe(true);
    expect(isHeavyCollectionWindow(MON_0630, mode)).toBe(true); // 경계 포함
    expect(HEAVY_NIGHT_WINDOW_END_MIN).toBe(6 * 60 + 30);
  });

  it('주중 심야 밖(07:00·정오)은 false', () => {
    expect(isHeavyCollectionWindow(MON_0700, mode)).toBe(false);
    expect(isHeavyCollectionWindow(MON_MIDDAY, mode)).toBe(false);
  });
});

describe('isHeavyCollectionWindow — env 기본 경로', () => {
  const KEY = 'HEAVY_COLLECTION_WINDOW';
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('env 미설정 시 weekend 정책(주중 false·주말 true)', () => {
    delete process.env[KEY];
    expect(isHeavyCollectionWindow(MON_MIDDAY)).toBe(false);
    expect(isHeavyCollectionWindow(SAT_MIDDAY)).toBe(true);
  });

  it('env=always 면 주중에도 true', () => {
    process.env[KEY] = 'always';
    expect(isHeavyCollectionWindow(MON_MIDDAY)).toBe(true);
  });

  it('env=weekend+night 면 주중 심야만 true', () => {
    process.env[KEY] = 'weekend+night';
    expect(isHeavyCollectionWindow(MON_NIGHT_0300)).toBe(true);
    expect(isHeavyCollectionWindow(MON_MIDDAY)).toBe(false);
  });
});
