import { useQuery } from '@tanstack/react-query';
import { simulationService } from '@services/simulation.service';

// 모의운용 현황 준실시간 폴링 훅 — DAR-42.
// refetchInterval 45s 로 서버 사이클 결과를 포트폴리오 화면에 자동 반영(준실시간).
// 백그라운드(앱 비활성)에서는 폴링 중단해 배터리/네트워크 절약.
const REFETCH_INTERVAL_MS = 45 * 1000;

export function useSimulationStatus() {
  return useQuery({
    queryKey: ['simulation', 'status'],
    queryFn: () => simulationService.getStatus(),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 30 * 1000,
    retry: 1,
  });
}
