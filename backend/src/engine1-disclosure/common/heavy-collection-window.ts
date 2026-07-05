// backend/src/engine1-disclosure/common/heavy-collection-window.ts
// DAR-503: 헤비 수집·스캔 잡(연속 백필·tables/rawtext 오프로드·파이프라인 전체 드레인)을
//          "언제 돌릴지" 판정하는 engine1 공용 순수 게이트.
//
// 배경(사용자 지시 2026-07-05 + 프로드 풀 고갈 실측): engine1 대형 스캔·백필이 주중 상시
//   가동돼 DB 커넥션 풀을 독점(health 503 플래핑)하고 DART 일일쿼터를 라이브 수집과 경쟁했다.
//   사용자 지시 = "수집(헤비 작업)은 주말에 진행 — 실시간 정보에 API를 쓰지 않아도 되는 날".
//   → 헤비 잡을 이 게이트로 주말 창으로 미루고, 주중엔 라이브 세이프티넷만 경량 유지한다.
//
// ★순수 함수(부작용 0·now 주입) — 시스템 TZ 무관(KST 벽시계는 Intl 기반 kstClock 사용).
// ★M10 클록 무접점: 수집층 스케줄링만 게이트한다 — 매매·신호 생성 로직과 무관.

import { kstClock } from '../../common/time/kst';

/**
 * 헤비 수집 창 정책.
 * - 'weekend'      : 기본. 토·일(KST) 전일에만 헤비 잡 가동, 주중 정지.
 * - 'always'       : 항상 가동(개발·수동 드레인·긴급 백필 소진용 오버라이드).
 * - 'weekend+night': 주말 + 주중 심야(KST 00:00~06:30) 추가 가동(향후 옵트인, 저부하 시간대).
 */
export type HeavyCollectionWindowMode = 'weekend' | 'always' | 'weekend+night';

/** env 미설정·오인값 시 적용할 기본 정책(사용자 지시 = 주말 전용). */
export const DEFAULT_HEAVY_COLLECTION_WINDOW_MODE: HeavyCollectionWindowMode =
  'weekend';

/**
 * 'weekend+night' 심야 창 종료 시각(KST 자정 기준 분, 06:30 포함).
 * 정규장(09:00~) 전에 여유를 두고 종료 — 라이브 수집 시작과 겹치지 않게 한다.
 */
export const HEAVY_NIGHT_WINDOW_END_MIN = 6 * 60 + 30; // 390

/** env HEAVY_COLLECTION_WINDOW 문자열을 정책으로 해석(오인값은 기본으로 폴백). */
export function resolveHeavyCollectionWindowMode(
  raw?: string | null,
): HeavyCollectionWindowMode {
  switch (raw) {
    case 'always':
    case 'weekend':
    case 'weekend+night':
      return raw;
    default:
      return DEFAULT_HEAVY_COLLECTION_WINDOW_MODE;
  }
}

/** KST 주말(토·일) 여부. kstClock 의 weekday 약어('Sat'|'Sun') 기준. */
function isKstWeekend(weekday: string): boolean {
  return weekday === 'Sat' || weekday === 'Sun';
}

/**
 * 지금(now)이 헤비 수집 창인가.
 *
 * @param now  판정 기준 시각(테스트 결정론을 위해 주입).
 * @param mode 정책. 미지정 시 env HEAVY_COLLECTION_WINDOW 를 해석(기본 'weekend').
 * @returns    헤비 잡을 돌려도 되는 창이면 true, 주중 정지 구간이면 false.
 */
export function isHeavyCollectionWindow(
  now: Date,
  mode: HeavyCollectionWindowMode = resolveHeavyCollectionWindowMode(
    process.env.HEAVY_COLLECTION_WINDOW,
  ),
): boolean {
  // 'always' — 요일·시각 무관 항상 가동(개발/수동 오버라이드).
  if (mode === 'always') return true;

  const { weekday, minutes } = kstClock(now);

  // 주말은 두 정책 공통으로 헤비 창.
  if (isKstWeekend(weekday)) return true;

  // 'weekend+night' — 주중 심야(00:00~06:30 KST)도 저부하 창으로 허용.
  if (mode === 'weekend+night' && minutes <= HEAVY_NIGHT_WINDOW_END_MIN) {
    return true;
  }

  // 그 외(주중 주간) = 헤비 잡 정지 구간.
  return false;
}
