import { useQuery } from '@tanstack/react-query';
import { graduationService } from '@services/graduation.service';

// 졸업 게이트 측정 준실시간 폴링 훅 — DAR-67.
// 서버 일일 사이클이 갱신하는 누적 졸업지표를 홈 졸업 트래커에 자동 반영(준실시간).
// queryKey ['graduation-metrics'] — 캐시 무효화 단일 키. 백그라운드 폴링 중단(배터리/네트워크 절약).
const REFETCH_INTERVAL_MS = 45 * 1000;

export function useGraduationMetrics() {
  return useQuery({
    queryKey: ['graduation-metrics'],
    queryFn: () => graduationService.getMetrics(),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 30 * 1000,
    retry: 1,
  });
}
