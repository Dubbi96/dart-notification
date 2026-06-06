import { api } from './api';
import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type { Disclosure, DisclosureAnalysis, DisclosureEvent, DisclosureType } from '@app-types/disclosure.types';

export const disclosureService = {
  getTypes: () =>
    api
      .get<ApiResponse<DisclosureType[]>>('/disclosures/types')
      .then((r) => r.data.data),

  getList: (
    page = 1,
    limit = 20,
    disclosureType?: string,
    watchlistOnly?: boolean,
    keywords?: string[],
    from?: string,
  ) =>
    api
      .get<ApiResponse<Disclosure[]>>('/disclosures', {
        params: {
          page,
          limit,
          ...(disclosureType && { disclosureType }),
          ...(watchlistOnly && { watchlistOnly: true }),
          ...(keywords && keywords.length > 0 && { keywords: keywords.join(',') }),
          ...(from && { from }),
        },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  getDetail: (rcpNo: string) =>
    api.get<ApiResponse<Disclosure>>(`/disclosures/${rcpNo}`).then((r) => r.data.data),

  search: (
    q: string,
    page = 1,
    disclosureType?: string,
    sort?: 'latest' | 'relevance',
    from?: string,
  ) =>
    api
      .get<ApiResponse<Disclosure[]>>('/disclosures/search', {
        params: {
          q,
          page,
          ...(disclosureType && { disclosureType }),
          ...(sort && { sort }),
          ...(from && { from }),
        },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  /** 공시 AI 이벤트 분석 결과 (실연동 — GET /disclosure-events/:rcpNo) */
  getEvent: (rcpNo: string) =>
    api
      .get<DisclosureEvent>(`/disclosure-events/${rcpNo}`)
      .then((r) => r.data)
      .catch(() => null),

  /**
   * 공시 AI 심층 분석 상세 (GET /disclosures/:rcpNo/analysis).
   * 엔드포인트는 분석 미생성 공시도 항상 빈 구조(analyses: [], personaAnalysis: null)를 200으로 반환한다.
   * → "분석 없음"은 빈 상태로, 네트워크/서버 오류는 에러 상태로 정직하게 분기하기 위해
   *   여기서 에러를 삼키지 않는다(에러는 useQuery.isError로 전파).
   */
  getAnalysis: (rcpNo: string): Promise<DisclosureAnalysis> =>
    api
      .get<ApiResponse<DisclosureAnalysis>>(`/disclosures/${rcpNo}/analysis`)
      .then((r) => r.data.data),
};
