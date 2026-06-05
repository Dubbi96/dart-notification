import { useQuery } from '@tanstack/react-query';
import { portfolioService } from '@services/portfolio.service';

export function usePositions() {
  return useQuery({
    queryKey: ['positions'],
    queryFn: () => portfolioService.getPositions(),
    retry: 1,
  });
}

export function usePortfolioSummary() {
  return useQuery({
    queryKey: ['portfolio', 'summary'],
    queryFn: () => portfolioService.getSummary(),
    retry: 1,
  });
}

export function usePosition(positionId: string) {
  return useQuery({
    queryKey: ['position', positionId],
    queryFn: () => portfolioService.getPosition(positionId),
    enabled: !!positionId,
    retry: 1,
  });
}

export function usePositionThesis(positionId: string) {
  return useQuery({
    queryKey: ['position', positionId, 'thesis'],
    queryFn: () => portfolioService.getThesis(positionId),
    enabled: !!positionId,
    retry: 1,
  });
}

export function usePaperPortfolio() {
  return useQuery({
    queryKey: ['paper-portfolio'],
    queryFn: () => portfolioService.getPaperPortfolio(),
    retry: 1,
  });
}
