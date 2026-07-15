import { useMutation } from '@tanstack/react-query';
import { searchService } from '@services/search.service';

/**
 * '미국 주식 알림, 필요하신가요?' 원탭 수요 기록 (갭분석 W8 계측 전용).
 * 서버 상태를 바꾸는 조회성 계측이므로 invalidate 대상 캐시가 없다.
 * 실패해도 사용자 흐름을 막지 않는다(버튼 UX 는 낙관적으로 처리).
 */
export function useRecordUsDemand() {
  return useMutation({
    mutationFn: (q?: string) => searchService.recordUsDemand(q),
  });
}
