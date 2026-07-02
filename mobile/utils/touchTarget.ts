// 접근성 터치 영역 유틸(DAR-146).
// 작은 칩·세그먼트 탭처럼 시각 높이가 44pt 미만인 컨트롤의 "시각 크기는 유지"하면서
// 유효 터치 영역만 권장 최소치(sizing.minTouchTarget=44pt)까지 확장하는 hitSlop을 계산한다.
//  - 세로(top/bottom) 부족분만 보정한다. 칩/탭의 가로 폭은 텍스트+좌우 패딩으로 이미 44pt를 넘으므로
//    수평 확장은 인접 칩의 터치 영역과 겹쳐 오탭을 유발할 수 있어 기본 0으로 둔다.
//  - 이미 44pt 이상이면 hitSlop은 0(부작용 없음).

import { sizing } from '@theme';

export interface HitSlop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * 주어진 시각 높이를 기준으로 유효 터치 높이를 최소 44pt로 만드는 세로 hitSlop을 반환한다.
 * @param visualHeight 컨트롤의 실효 시각 높이(px). 고정 height 또는 paddingVertical*2 + lineHeight.
 */
export function verticalHitSlopForHeight(visualHeight: number): HitSlop {
  const deficit = sizing.minTouchTarget - visualHeight;
  const pad = deficit > 0 ? Math.ceil(deficit / 2) : 0;
  return { top: pad, bottom: pad, left: 0, right: 0 };
}

/**
 * 아이콘 전용 버튼(X·뒤로가기 등)의 유효 터치 영역을 최소 44pt로 만드는 4방향 대칭 hitSlop을 반환한다.
 * 칩처럼 텍스트 좌우 패딩으로 가로폭이 이미 확보되는 컨트롤과 달리, 아이콘만 있는 버튼은
 * 시각 크기가 가로·세로 모두 44pt에 못 미치므로 4방향 대칭으로 보정한다(DAR-146 규약·DAR-267).
 * SearchOverlay 로컬 구현을 공용으로 승격(UXR-19/A-6) — 화면별 hitSlop 드리프트 방지.
 * @param iconSize 아이콘의 시각 크기(px). 예: Feather 'x-circle' size 18 → 18 + 13*2 = 44pt.
 */
export function symmetricHitSlopForIcon(iconSize: number): HitSlop {
  const pad = Math.max(0, Math.ceil((sizing.minTouchTarget - iconSize) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
