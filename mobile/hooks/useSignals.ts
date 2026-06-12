import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { signalService } from '@services/signal.service';
import { eventStudyService } from '@services/event-study.service';

import type { SignalFilters, SignalExploreFilters } from '@app-types/signal.types';

export function useBuySignals(filters?: SignalFilters) {
  return useQuery({
    queryKey: ['signals', 'buy', filters?.personaType, filters?.grade, filters?.entryReady],
    queryFn: () => signalService.getBuySignals(filters),
    retry: 1,
  });
}

/**
 * 종목 의사결정 허브(DAR-59) — 특정 corpCode의 최신 매수 신호 1건.
 * 기존 /signals 피드(전체 매수 신호)를 조립해 해당 종목 신호를 client-side로 선별한다.
 * 별도 종목별 신호 엔드포인트가 없으므로 피드에 미노출이면 null(결측 graceful 부분노출).
 */
export function useCompanyBuySignal(corpCode: string | undefined) {
  return useQuery({
    queryKey: ['signals', 'company', corpCode],
    queryFn: async () => {
      const signals = await signalService.getBuySignals();
      return signals.find((s) => s.corpCode === corpCode) ?? null;
    },
    enabled: !!corpCode,
    retry: 1,
    staleTime: 60 * 1000,
  });
}

/**
 * 종목별 최신 신호 단건(DAR-159) — 종목 상세 헤더 신호 배지용.
 * 전용 엔드포인트 GET /signals/by-corp/:corpCode 를 사용해 해당 종목 최신 신호
 * (등급·점수·진입준비)만 경량 조회한다. 백필 제외는 백엔드가 보장.
 * 신호 없으면 data=null → 배지 미표시(빈상태 흡수).
 */
export function useCompanySignal(corpCode: string | undefined) {
  return useQuery({
    queryKey: ['signals', 'company-badge', corpCode],
    queryFn: () => signalService.getCompanySignal(corpCode!),
    enabled: !!corpCode,
    retry: 1,
    staleTime: 60 * 1000,
  });
}

/**
 * 등급무관 전체 시그널 탐색(DAR-46) — 무한스크롤(DAR-45 패턴 재사용).
 * grade 미지정 시 전체 등급을 조회하며, 필터/정렬 변경은 queryKey로 새 조회를 트리거한다.
 */
export function useExploreSignals(filters: SignalExploreFilters) {
  return useInfiniteQuery({
    queryKey: [
      'signals',
      'explore',
      filters.grade,
      filters.personaType,
      filters.eventType,
      filters.sort,
    ],
    queryFn: ({ pageParam = 1 }) => signalService.getSignals(filters, pageParam, 20),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
    retry: 1,
  });
}

export function useExitSignals() {
  return useQuery({
    queryKey: ['signals', 'exit'],
    queryFn: () => signalService.getExitSignals(),
    retry: 1,
  });
}

export function useSignalDetail(id: string) {
  return useQuery({
    queryKey: ['signal', id],
    queryFn: () => signalService.getBuySignalDetail(id),
    enabled: !!id,
    retry: 1,
  });
}

export function useEventStudy(eventType?: string, marketType?: string) {
  return useQuery({
    queryKey: ['event-study', eventType, marketType],
    queryFn: () => eventStudyService.getResults(eventType, marketType),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}
