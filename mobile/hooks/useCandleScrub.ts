import { useState } from 'react';

import type { GestureResponderEvent, AccessibilityActionEvent } from 'react-native';

/**
 * DAR-472: 일봉/분봉 캔들차트가 글자 단위로 복제하던 가로 스크럽(크로스헤어) 상호작용 추출(DAR-458 E6).
 *
 * 손가락 X 좌표 → 가장 가까운 캔들 인덱스를 골라(슬롯이 1px라도 선택 가능) 크로스헤어를 옮긴다.
 * 스크린리더는 증/감(adjustable) 액션으로 한 칸씩 이동한다. 기본 선택은 마지막(최신) 캔들이며,
 * 캔들 수/슬롯 폭이 바뀌어도 인덱스는 항상 [0, count-1] 로 clamp 된다.
 */
interface CandleScrubGeometry {
  /** 캔들 개수(n). */
  count: number;
  /** 슬롯 1개의 픽셀 폭(plotW / n). */
  slotW: number;
  /** 좌측 패딩(px) — 차트 원점 보정. */
  padLeft: number;
}

interface CandleScrub {
  /** 현재 선택(또는 최신) 캔들 인덱스. */
  activeIndex: number;
  /** 스크럽 제스처(grant/move) 핸들러 — locationX 로 선택 갱신. */
  handleScrub: (e: GestureResponderEvent) => void;
  /** adjustable a11y 액션(increment/decrement) 핸들러 — 한 칸씩 이동. */
  handleA11yAction: (e: AccessibilityActionEvent) => void;
}

export function useCandleScrub({ count, slotW, padLeft }: CandleScrubGeometry): CandleScrub {
  // 선택된 캔들(요약). 기본은 마지막(최신).
  const [selected, setSelected] = useState<number | null>(null);

  const clamp = (i: number) => Math.min(count - 1, Math.max(0, i));
  // 가로 스크럽(크로스헤어) — 손가락 X → 가장 가까운 캔들 인덱스. 슬롯이 1px라도 선택 가능(E6).
  const indexFromX = (x: number) => clamp(Math.round((x - padLeft) / slotW - 0.5));
  const handleScrub = (e: GestureResponderEvent) =>
    setSelected(indexFromX(e.nativeEvent.locationX));
  // a11y: 스크린리더는 증감 액션으로 한 칸씩 이동(adjustable).
  const stepSelection = (dir: 1 | -1) =>
    setSelected((prev) => clamp((prev ?? count - 1) + dir));
  const handleA11yAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') stepSelection(1);
    else if (e.nativeEvent.actionName === 'decrement') stepSelection(-1);
  };

  const activeIndex = selected ?? count - 1;
  return { activeIndex, handleScrub, handleA11yAction };
}
