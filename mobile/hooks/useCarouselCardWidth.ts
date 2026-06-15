import { useWindowDimensions } from 'react-native';
import { computeCarouselMetrics } from '@utils/carouselMetrics';

import type { CarouselMetrics } from '@utils/carouselMetrics';

// 가로 카루셀 카드 폭 반응형 훅(DAR-301). 순수 산출 로직은 @utils/carouselMetrics,
// 여기서는 useWindowDimensions 로 회전·폰트스케일 변화에 반응만 한다.
export { CAROUSEL_H_PADDING, CAROUSEL_GAP } from '@utils/carouselMetrics';
export type { CarouselMetrics } from '@utils/carouselMetrics';

/**
 * 화면 폭 반응형 카드 폭/스냅 간격을 산출한다.
 */
export function useCarouselCardWidth(): CarouselMetrics {
  const { width } = useWindowDimensions();
  return computeCarouselMetrics(width);
}
