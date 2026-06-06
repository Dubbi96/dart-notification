import { useQuery } from '@tanstack/react-query';
import { backtestService } from '@services/backtest.service';

// 신호 보정 루프 리포트 조회 훅 — DAR-92. queryKey ['calibration'].
// 백테스트 집계 기반이라 자주 안 바뀜 → staleTime 5분, 실패 1회 재시도.
// ★ read-only — 권장 delta·보정계수를 화면에 "표시만" 한다(자동반영 없음).
export function useCalibration() {
  return useQuery({
    queryKey: ['calibration'],
    queryFn: () => backtestService.getCalibration(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
