import { useQuery } from '@tanstack/react-query';
import { graduationService } from '@services/graduation.service';

// 신호→진입 퍼널 준실시간 폴링 훅 — DAR-162(백엔드 DAR-109 GET /graduation/funnel 소비).
// 서버 일일 사이클이 누적하는 '신호→후보→체결' 전환 데이터를 졸업 트래커에 자동 반영.
// queryKey ['graduation-funnel'] — graduation-metrics 와 별개 캐시 키.
// 백그라운드 폴링 중단(배터리/네트워크 절약), useGraduationMetrics 와 동일 정책.
const REFETCH_INTERVAL_MS = 45 * 1000;

export function useGraduationFunnel() {
  return useQuery({
    queryKey: ['graduation-funnel'],
    queryFn: () => graduationService.getFunnel(),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 30 * 1000,
    retry: 1,
  });
}
