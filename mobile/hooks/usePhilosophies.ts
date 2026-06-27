// 투자거장 철학(P-A)·적합도(P-B) 서버 상태 훅 (DAR-54)
// React Query 래핑. 철학 데이터는 시드 기반으로 사실상 정적 → staleTime 길게.
// 게스트 열람 가능 — 인증 게이팅 없음.
import { useQuery } from '@tanstack/react-query';
import { philosophyService } from '@services/philosophy.service';

const PHILOSOPHY_STALE = 1000 * 60 * 30; // 30분(시드 기반·거의 정적)

/** 투자자 철학 목록(4종). styleTag 로 선택 필터. */
export function usePhilosophies(styleTag?: string) {
  return useQuery({
    queryKey: ['philosophies', styleTag ?? 'all'],
    queryFn: () => philosophyService.getPhilosophies(styleTag),
    staleTime: PHILOSOPHY_STALE,
    retry: 1,
  });
}

/**
 * 철학 1종 × 종목 1건 적합도. corpCode 가 있어야 활성화.
 * enabled: 뷰포트 지연 로딩 게이트(DAR-465) — 리스트에서 화면에 보이는 행만 fetch 해
 *   진입 시 동시 요청 폭주를 막는다. 기본 true(기존 호출부 무변경). 전역 staleTime 5분이
 *   적용되어 스크롤 복귀 시 재요청은 발생하지 않는다(services/queryClient.ts).
 */
export function usePhilosophyFit(
  philosophyId: string | undefined,
  corpCode: string | undefined,
  fsDiv?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['philosophy-fit', philosophyId, corpCode, fsDiv ?? 'CFS'],
    queryFn: () => philosophyService.getPhilosophyFit(philosophyId!, corpCode!, fsDiv),
    enabled: !!philosophyId && !!corpCode && enabled,
    retry: 1,
  });
}

/** 종목 × 거장별 적합도(전체 철학). */
export function useCompanyPhilosophyFit(corpCode: string | undefined, fsDiv?: string) {
  return useQuery({
    queryKey: ['company-philosophy-fit', corpCode, fsDiv ?? 'CFS'],
    queryFn: () => philosophyService.getCompanyFit(corpCode!, fsDiv),
    enabled: !!corpCode,
    retry: 1,
  });
}

/**
 * 종목 × 거장 철학 × AI 관점 결합(P-C, DAR-72/82).
 * 신규 AI 호출 0 — 저장된 산출물만 조회. corpCode 가 있어야 활성화.
 */
export function useCompanyPersonaPhilosophyFusion(
  corpCode: string | undefined,
  fsDiv?: string,
) {
  return useQuery({
    queryKey: ['persona-philosophy-fusion', corpCode, fsDiv ?? 'CFS'],
    queryFn: () => philosophyService.getCompanyFusion(corpCode!, fsDiv),
    enabled: !!corpCode,
    retry: 1,
  });
}
