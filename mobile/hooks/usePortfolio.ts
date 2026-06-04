import { useQuery } from '@tanstack/react-query';
import { portfolioService } from '@services/portfolio.service';

// 포트폴리오 엔드포인트가 아직 없으므로 retry는 끈다.
// 서비스 레이어가 404를 빈 값으로 흡수해 화면은 깔끔한 빈 상태를 받는다.

export function usePositions() {
  return useQuery({
    queryKey: ['positions'],
    queryFn: () => portfolioService.getPositions(),
    retry: false,
  });
}

export function usePortfolioSummary() {
  return useQuery({
    queryKey: ['portfolio', 'summary'],
    queryFn: () => portfolioService.getSummary(),
    retry: false,
  });
}

export function usePosition(positionId: string) {
  return useQuery({
    queryKey: ['position', positionId],
    queryFn: () => portfolioService.getPosition(positionId),
    enabled: !!positionId,
    retry: false,
  });
}

export function usePositionThesis(positionId: string) {
  return useQuery({
    queryKey: ['position', positionId, 'thesis'],
    queryFn: () => portfolioService.getThesis(positionId),
    enabled: !!positionId,
    retry: false,
  });
}

export function usePaperPortfolio() {
  return useQuery({
    queryKey: ['paper-portfolio'],
    queryFn: () => portfolioService.getPaperPortfolio(),
    retry: false,
  });
}
