import { useQuery } from '@tanstack/react-query';
import { portfolioService } from '@services/portfolio.service';

// queryKey 컨벤션 [entity, ...params]: 포트폴리오 도메인은 공통 접두사 ['portfolio']로
// 정렬한다. 포지션 변경 후 invalidateQueries({ queryKey: PORTFOLIO_KEY }) 한 번으로
// 목록·요약·리스크·단건이 함께 갱신되며(전체 무효화), 하위 접두사로 부분 무효화도 가능하다.
export const PORTFOLIO_KEY = ['portfolio'] as const;

export const portfolioKeys = {
  all: PORTFOLIO_KEY,
  positions: () => [...PORTFOLIO_KEY, 'positions'] as const,
  summary: () => [...PORTFOLIO_KEY, 'summary'] as const,
  risk: () => [...PORTFOLIO_KEY, 'risk', 'latest'] as const,
  position: (positionId: string) => [...PORTFOLIO_KEY, 'position', positionId] as const,
  thesis: (positionId: string) =>
    [...PORTFOLIO_KEY, 'position', positionId, 'thesis'] as const,
  paper: () => [...PORTFOLIO_KEY, 'paper'] as const,
};

export function usePositions() {
  return useQuery({
    queryKey: portfolioKeys.positions(),
    queryFn: () => portfolioService.getPositions(),
    retry: 1,
  });
}

export function usePortfolioSummary() {
  return useQuery({
    queryKey: portfolioKeys.summary(),
    queryFn: () => portfolioService.getSummary(),
    retry: 1,
  });
}

export function usePortfolioRisk() {
  return useQuery({
    queryKey: portfolioKeys.risk(),
    queryFn: () => portfolioService.getRiskSnapshot(),
    retry: 1,
  });
}

export function usePosition(positionId: string) {
  return useQuery({
    queryKey: portfolioKeys.position(positionId),
    queryFn: () => portfolioService.getPosition(positionId),
    enabled: !!positionId,
    retry: 1,
  });
}

export function usePositionThesis(positionId: string) {
  return useQuery({
    queryKey: portfolioKeys.thesis(positionId),
    queryFn: () => portfolioService.getThesis(positionId),
    enabled: !!positionId,
    retry: 1,
  });
}

export function usePaperPortfolio() {
  return useQuery({
    queryKey: portfolioKeys.paper(),
    queryFn: () => portfolioService.getPaperPortfolio(),
    retry: 1,
  });
}
