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
  briefing: () => [...PORTFOLIO_KEY, 'briefing', 'today'] as const,
};

// UXR-13 P-5(DAR-471 접힘 게이팅과 동일 사상): 포트폴리오 화면은 6개 서브탭이 한 화면을
// 공유하므로, 활성 서브탭이 실제로 그리는 쿼리만 발화하도록 호출부가 enabled 를 주입한다.
// 미지정(undefined)은 기존 동작 보존(발화) — 다른 호출부(탭 배지 등) 회귀 0.
export interface PortfolioQueryOptions {
  enabled?: boolean;
}

export function usePositions(options?: PortfolioQueryOptions) {
  return useQuery({
    queryKey: portfolioKeys.positions(),
    queryFn: () => portfolioService.getPositions(),
    enabled: options?.enabled ?? true,
    retry: 1,
  });
}

export function usePortfolioSummary(options?: PortfolioQueryOptions) {
  return useQuery({
    queryKey: portfolioKeys.summary(),
    queryFn: () => portfolioService.getSummary(),
    enabled: options?.enabled ?? true,
    retry: 1,
  });
}

export function usePortfolioRisk(options?: PortfolioQueryOptions) {
  return useQuery({
    queryKey: portfolioKeys.risk(),
    queryFn: () => portfolioService.getRiskSnapshot(),
    enabled: options?.enabled ?? true,
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

export function usePaperPortfolio(options?: PortfolioQueryOptions) {
  return useQuery({
    queryKey: portfolioKeys.paper(),
    queryFn: () => portfolioService.getPaperPortfolio(),
    enabled: options?.enabled ?? true,
    retry: 1,
  });
}

/**
 * W14 오늘의 브리핑 — 당일 이벤트·일간 손익·점검 포지션 결합 조회.
 * 전 섹션 0건이면 data 는 null(화면은 섹션 자체를 그리지 않는다 — 0건 억제 계약).
 * 보조 표면: 당일 데이터라 staleTime 5분, 재시도 1회로 소음 억제.
 */
export function useTodayBriefing(options?: PortfolioQueryOptions) {
  return useQuery({
    queryKey: portfolioKeys.briefing(),
    queryFn: () => portfolioService.getTodayBriefing(),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
