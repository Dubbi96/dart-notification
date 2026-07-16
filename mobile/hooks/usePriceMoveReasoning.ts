import { useQuery } from '@tanstack/react-query';
import { priceMoveService } from '@services/priceMove.service';

/**
 * PRICE_MOVE 역방향 리즈닝 — GET /price-move-reasonings/:refId 소비(DAR-524, C1=DAR-522).
 * 등락 이벤트(refId)당 1행으로 멱등 저장돼 산출 후 사실상 불변이라 30분 staleTime.
 *
 * retry:false — 정직 3상태 분기(리즈닝/무공시/로딩실패)에서 '로딩실패'는 자동 재시도로
 * 숨기지 않고 재시도 동선과 함께 그대로 노출한다(useDisclosureReactionStats 정책 정렬).
 */
export function usePriceMoveReasoning(refId: string) {
  return useQuery({
    queryKey: ['price-move-reasoning', refId],
    queryFn: () => priceMoveService.getReasoning(refId),
    enabled: !!refId,
    retry: false,
    staleTime: 1000 * 60 * 30, // 30분 — 등락 이벤트당 1행 멱등 캐시, 재진입 시 불필요 재요청 방지
  });
}
