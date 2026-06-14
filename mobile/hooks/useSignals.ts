import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { signalService } from '@services/signal.service';
import { eventStudyService } from '@services/event-study.service';
import { CURATION_BUY_GRADES } from '@utils/signalCuration';

import type { SignalFilters, SignalExploreFilters } from '@app-types/signal.types';

/**
 * 홈/신호탭 '상위 매수 신호' 큐레이션 기본 필터(DAR-193).
 * 매수등급(STRONG_BUY/BUY)만 점수 내림차순으로 받아 "최근성에 가려진 빈상태"를 해소한다.
 * (기존: grade 필터 없이 latest-20 → 대부분 NEUTRAL이라 매수등급 0건 위장 빈상태)
 * 빈상태는 시스템에 매수등급 신호가 진짜 0건일 때만 발생.
 */
const CURATION_FILTERS: SignalFilters = {
  grade: [...CURATION_BUY_GRADES],
  sort: 'score',
};

export function useBuySignals(filters?: SignalFilters) {
  // 인자 미지정 시 점수순 매수등급 큐레이션을 기본으로 사용(홈 프리뷰·신호탭 L1 공통).
  const effective = filters ?? CURATION_FILTERS;
  return useQuery({
    queryKey: [
      'signals',
      'buy',
      effective.personaType,
      effective.grade,
      effective.entryReady,
      effective.sort,
    ],
    queryFn: () => signalService.getBuySignals(effective),
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
 * 공시(rcpNo) → 매수 신호 역링크(DAR-208) — 공시 상세 AI섹션 진입 카드용.
 * 전용 엔드포인트 GET /signals/by-disclosure/:rcpNo 로 해당 공시로 생성된 최신 신호
 * (등급·점수·id)를 경량 조회한다. 신호가 없으면 data=null → 카드 미표시(빈상태 흡수).
 * 신호 API는 인증 필요(JWT) — 게스트는 enabled=false로 호출 자체를 막아 401 소음 차단.
 */
export function useDisclosureSignal(
  rcpNo: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['signals', 'by-disclosure', rcpNo],
    queryFn: () => signalService.getSignalByDisclosure(rcpNo!),
    enabled: (options?.enabled ?? true) && !!rcpNo,
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
