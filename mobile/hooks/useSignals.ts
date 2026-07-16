import { useEffect } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { signalService } from '@services/signal.service';
import { eventStudyService } from '@services/event-study.service';
import { CURATION_BUY_GRADES } from '@utils/signalCuration';
import { isTodayEditionDate } from '@utils/signalTerms';

import type {
  SignalFilters,
  SignalExploreFilters,
} from '@app-types/signal.types';

/**
 * 홈/신호탭 '상위 매수 신호' 큐레이션 기본 필터(DAR-193).
 * 매수등급(STRONG_BUY/BUY)만 점수 내림차순으로 받아 "최근성에 가려진 빈상태"를 해소한다.
 * (기존: grade 필터 없이 latest-20 → 대부분 NEUTRAL이라 매수등급 0건 위장 빈상태)
 * 빈상태는 시스템에 매수등급 신호가 진짜 0건일 때만 발생.
 * sinceDays=14: 최신성 윈도우 — 점수순이 전체 이력 고득점(과거 신호)에 영원히 고정되지 않게
 * 최근 14일 신호만 받는다(백엔드 sort=score 기본값과 동일 계약을 명시). 빈 결과면 기존 빈상태 UI.
 */
const CURATION_FILTERS: SignalFilters = {
  grade: [...CURATION_BUY_GRADES],
  sort: 'score',
  sinceDays: 14,
};

/**
 * 매수 신호 피드 queryKey 빌더(UXR-23 P-2) — 피드(useBuySignals)와 종목 1건
 * select(useCompanyBuySignal)가 문자 그대로 같은 캐시 엔트리를 공유하도록 단일화한다.
 */
function buySignalsFeedKey(filters: SignalFilters) {
  return [
    'signals',
    'buy',
    filters.personaType,
    filters.grade,
    filters.entryReady,
    filters.sort,
    filters.sinceDays,
  ];
}

/** 피드 공유 staleTime — 피드·종목 관찰자가 같은 신선도 기준을 써 중복 refetch를 막는다(UXR-23 P-2). */
const BUY_FEED_STALE_TIME_MS = 60 * 1000;

/** 에디션 날짜 목록 staleTime(DAR-507) — 하루 1호라 자주 변하지 않음(5분). */
const EDITIONS_LIST_STALE_TIME_MS = 5 * 60 * 1000;
/** 오늘 에디션 staleTime — 19:00 발행·장중 갱신 가능성으로 짧게(60초). */
const EDITION_TODAY_STALE_TIME_MS = 60 * 1000;
/** 과거 에디션 staleTime — 지난 거래일 판단은 불변 → 길게(1시간)로 재fetch 억제. */
const EDITION_PAST_STALE_TIME_MS = 60 * 60 * 1000;

/** 에디션 date(YYYYMMDD)별 staleTime — 오늘만 짧게, 과거는 불변이라 길게. */
function editionStaleTime(date: string | undefined): number {
  return isTodayEditionDate(date) ? EDITION_TODAY_STALE_TIME_MS : EDITION_PAST_STALE_TIME_MS;
}

export function useBuySignals(filters?: SignalFilters) {
  // 인자 미지정 시 점수순 매수등급 큐레이션을 기본으로 사용(홈 프리뷰·신호탭 L1 공통).
  const effective = filters ?? CURATION_FILTERS;
  return useQuery({
    queryKey: buySignalsFeedKey(effective),
    queryFn: () => signalService.getBuySignals(effective),
    retry: 1,
    staleTime: BUY_FEED_STALE_TIME_MS,
  });
}

/**
 * 종목 의사결정 허브(DAR-59) — 특정 corpCode의 최신 매수 신호 1건(scoreBreakdown 포함).
 * DAR-507: 홈이 에디션 훅으로 전환되면 공유하던 `buySignalsFeedKey`(UXR-23)가 더는
 * 채워지지 않아 종목 드릴다운이 캐시 미스로 14일 큐레이션 피드 전량을 재다운로드하게 된다.
 * → 홈 피드키 의존을 끊고 종목 전용 엔드포인트 조합으로 이관한다:
 *   1) GET /signals/by-corp/:corpCode(findLatestByCorpCode) 로 그 종목 최신 신호 id/배지 확보,
 *   2) id 로 GET /signals/:id(findOne) 상세를 받아 scoreBreakdown 을 보존한다.
 * (배지 엔드포인트는 scoreBreakdown 을 싣지 않으므로 상세 단계 없이는 '점수 기여 상위' 회귀.)
 * queryKey 는 `['signals','company-buy',corpCode]` 로 corpCode 격리 + `['signals']` 네임스페이스
 * 하위 → pull-to-refresh invalidateQueries({queryKey:['signals']})가 함께 갱신.
 * 종목 신호가 없으면 null(결측 graceful) — 기존 계약 유지.
 */
export function useCompanyBuySignal(corpCode: string | undefined) {
  return useQuery({
    queryKey: ['signals', 'company-buy', corpCode],
    queryFn: async () => {
      const badge = await signalService.getCompanySignal(corpCode!);
      if (!badge) return null;
      // scoreBreakdown·근거지표는 상세(findOne)에만 존재 — 배지 id 로 전체 신호를 승격 조회.
      return signalService.getBuySignalDetail(badge.id);
    },
    enabled: !!corpCode,
    retry: 1,
    staleTime: BUY_FEED_STALE_TIME_MS,
  });
}

/**
 * 일일 투자판단 에디션 날짜 목록(DAR-505/507) — 판단 존재일만 최신순(빈 날 미포함).
 * 날짜 스트립·아카이브가 소비. before 커서로 과거 페이지네이션(meta.nextCursor).
 * queryKey 는 `['signals','daily-editions', before]` — `['signals']` 네임스페이스 하위라
 * pull-to-refresh invalidateQueries({queryKey:['signals']})가 함께 갱신한다.
 */
export function useDailyEditions(before?: string) {
  return useQuery({
    queryKey: ['signals', 'daily-editions', before],
    queryFn: () => signalService.getDailyEditions(before),
    retry: 1,
    staleTime: EDITIONS_LIST_STALE_TIME_MS,
  });
}

/**
 * 특정 KST 거래일 에디션 상세(DAR-505/507) — 매수등급 랭킹 + meta(빈 사유·인접 에디션일).
 * queryKey `['signals','edition', date]`, date 없으면 enabled:false. staleTime 은 오늘(60s)·
 * 과거(불변, 1시간) 분기. 인접 에디션(meta.prev·nextEditionDate)을 프리페치해 날짜 스트립
 * 좌우 플립을 즉시화한다(빈 날은 스트립에 없으므로 ±1 달력일이 아닌 '인접 에디션일'을 프리페치).
 */
export function useEdition(date: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['signals', 'edition', date],
    queryFn: () => signalService.getEdition(date!),
    enabled: !!date,
    retry: 1,
    staleTime: editionStaleTime(date),
  });

  // meta 확정 후 인접 에디션(직전·직후 판단 존재일)을 프리페치 — 플립 시 캐시 히트.
  const prevEditionDate = query.data?.meta.prevEditionDate;
  const nextEditionDate = query.data?.meta.nextEditionDate;
  useEffect(() => {
    for (const adjacent of [prevEditionDate, nextEditionDate]) {
      if (!adjacent) continue;
      void queryClient.prefetchQuery({
        queryKey: ['signals', 'edition', adjacent],
        queryFn: () => signalService.getEdition(adjacent),
        staleTime: editionStaleTime(adjacent),
      });
    }
  }, [prevEditionDate, nextEditionDate, queryClient]);

  return query;
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
