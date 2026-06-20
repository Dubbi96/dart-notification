import { useQuery } from '@tanstack/react-query';
import { backtestService } from '@services/backtest.service';

// 1년 자동매매 백테스트 트랙레코드 조회 훅 — DAR-388 (백엔드 DAR-385).
// 트랙레코드는 운영 리플레이 1회당 갱신되는 정적 집계 → 폴링 불필요(staleTime 길게).
// data=null(미실행/미완료)도 정상 응답 → 화면이 빈 상태로 graceful 처리.
// queryKey ['backtest-track-record'] — 단일 최신본 캐시 키.
const STALE_TIME_MS = 5 * 60 * 1000;

export function useBacktestTrackRecord() {
  return useQuery({
    queryKey: ['backtest-track-record'],
    queryFn: () => backtestService.getTrackRecord(),
    staleTime: STALE_TIME_MS,
    retry: 1,
  });
}
