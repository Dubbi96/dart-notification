import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { disclosureService } from '@services/disclosure.service';

export function useDisclosures(
  disclosureType?: string,
  watchlistOnly?: boolean,
  keywords?: string[],
  from?: string,
) {
  return useInfiniteQuery({
    queryKey: ['disclosures', disclosureType, watchlistOnly, keywords, from],
    queryFn: ({ pageParam = 1 }) =>
      disclosureService.getList(pageParam, 20, disclosureType, watchlistOnly, keywords, from),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
  });
}

/**
 * '오늘의 공시' 집계 (GET /disclosures/today-count, DAR-420).
 * 홈 요약 카드의 '오늘의 공시'는 전체 누적(meta.total)이 아니라 최신 가용 공시일 건수를 쓴다.
 * 게스트 조회 가능. 시간 경과로 최신일이 바뀔 수 있어 5분 staleTime으로 가볍게 캐시.
 */
export function useTodayDisclosureCount() {
  return useQuery({
    queryKey: ['disclosures', 'today-count'],
    queryFn: () => disclosureService.getTodayCount(),
    staleTime: 1000 * 60 * 5,
  });
}

export function useDisclosureSearch(
  query: string,
  disclosureType?: string,
  sort?: 'latest' | 'relevance',
  from?: string,
) {
  return useInfiniteQuery({
    queryKey: ['disclosures', 'search', query, disclosureType, sort, from],
    queryFn: ({ pageParam = 1 }) =>
      disclosureService.search(query, pageParam, disclosureType, sort, from),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
    enabled: query.length >= 1,
  });
}

export function useDisclosureDetail(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure', rcpNo],
    queryFn: () => disclosureService.getDetail(rcpNo),
    enabled: !!rcpNo,
    staleTime: 1000 * 60 * 30, // 30분 — rcpNo 공시 상세는 발행 후 사실상 불변, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}

/** 공시 AI 이벤트 분석 — GET /disclosure-events/:rcpNo 실연동. 미존재 시 null. */
export function useDisclosureEvent(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-event', rcpNo],
    queryFn: () => disclosureService.getEvent(rcpNo),
    enabled: !!rcpNo,
    retry: false,
    staleTime: 1000 * 60 * 30, // 30분 — rcpNo 단건 이벤트 분석은 사실상 불변, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}

// DAR-471: 접이식 'AI 심층 분석' 카드는 기본 접힘 → 펼칠 때만 발화하도록 enabled 게이팅을 위임받는다.
//   options.enabled 미지정 시 기존 동작(rcpNo 있으면 즉시 조회) 보존.
//   (인라인 객체 타입 대신 명명 인터페이스 — 시그니처에 '{' 노출 안 함, DAR-334 staletime 가드 본문추출 호환.)
interface DisclosureAnalysisOptions {
  enabled?: boolean;
}

export function useDisclosureAnalysis(rcpNo: string, options?: DisclosureAnalysisOptions) {
  return useQuery({
    queryKey: ['disclosure-analysis', rcpNo],
    queryFn: () => disclosureService.getAnalysis(rcpNo),
    enabled: !!rcpNo && (options?.enabled ?? true),
    retry: false,
    // 30분 — rcpNo 단건 AI 요약은 사실상 불변. 재처리 후 갱신은 invalidate 경로로 즉시 반영되므로 staleTime은 자동 refetch만 억제(기업메타 정책 정렬)
    staleTime: 1000 * 60 * 30,
  });
}

/** 공시 본문 정량 fact — GET /disclosure-facts/:rcpNo 실연동(DAR-112). 추출 없으면 빈 배열. */
export function useDisclosureFiledFacts(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-facts', rcpNo],
    queryFn: () => disclosureService.getFiledFacts(rcpNo),
    enabled: !!rcpNo,
    retry: false,
    staleTime: 1000 * 60 * 30, // 30분 — rcpNo 본문 정량 fact는 발행 후 불변, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}

/**
 * 과거 유사공시 반응 통계 — GET /disclosures/:rcpNo/event-stats 실연동(DAR-511/512).
 * 같은 이벤트 유형 공시의 D+1/D+5/D+20 실제 주가 반응·승률·표본수(n).
 * 산출 후 사실상 불변인 과거 통계(일1회 캐시)라 30분 staleTime + 재시도 없음(정직 3상태 분기).
 */
export function useDisclosureReactionStats(rcpNo: string) {
  return useQuery({
    queryKey: ['disclosure-reaction-stats', rcpNo],
    queryFn: () => disclosureService.getEventStats(rcpNo),
    enabled: !!rcpNo,
    retry: false,
    staleTime: 1000 * 60 * 30, // 30분 — 산출 후 사실상 불변인 과거 반응 통계, 재진입 시 불필요 재요청 방지(기업메타 정책 정렬)
  });
}
