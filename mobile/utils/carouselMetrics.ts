import { spacing } from '@theme/spacing';

// 가로 카루셀 카드 폭 산출 SSOT(DAR-301) — RN 비의존 순수 로직.
// 기존 고정 px(264/272)는 넓은 기기에서 카드가 좁아 좌우 여백이 과도하고
// 다음 카드 peek 비율이 기기별로 어긋났다. 화면 폭 기반 반응형으로 전환해
// 다양한 폭에서 카드가 화면을 적절히 채우고 peek 비율을 일정하게 유지한다.
//
// 레이아웃 계약(두 카루셀 공통): contentContainer 좌우 padding = spacing.lg,
// 카드 간 gap = spacing.md. 카드 폭/스냅을 이 계약 위에서 산출한다.

/** 카루셀 contentContainer 좌우 패딩(좌측 정렬 기준점). */
export const CAROUSEL_H_PADDING = spacing.lg;
/** 카드 사이 간격. snapToInterval = 카드폭 + 이 값. */
export const CAROUSEL_GAP = spacing.md;

// 좌측 패딩 이후 가용 트랙의 약 86%를 카드가 차지(나머지 ~14% = gap + 다음 카드 peek).
export const CARD_WIDTH_RATIO = 0.86;
// 태블릿·가로 등 초광폭에서 카드 1장이 과대해지지 않도록 상한.
export const MAX_CARD_WIDTH = 420;

export interface CarouselMetrics {
  /** 카드 1장 폭(px, 정수). */
  cardWidth: number;
  /** FlatList snapToInterval = 카드폭 + gap(카드 단위 스냅). */
  snapToInterval: number;
}

/**
 * 화면 폭 → 카드 폭/스냅 간격. 좌측 패딩 이후 트랙의 86%를 카드가 차지하되
 * 초광폭에서는 상한(MAX_CARD_WIDTH)으로 캡한다.
 */
export function computeCarouselMetrics(windowWidth: number): CarouselMetrics {
  const track = windowWidth - CAROUSEL_H_PADDING;
  const cardWidth = Math.round(Math.min(track * CARD_WIDTH_RATIO, MAX_CARD_WIDTH));
  return { cardWidth, snapToInterval: cardWidth + CAROUSEL_GAP };
}
