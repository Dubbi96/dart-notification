import { api } from './api';
import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type { Disclosure, DisclosureEvent, DisclosureType } from '@app-types/disclosure.types';

export const disclosureService = {
  getTypes: () =>
    api
      .get<ApiResponse<DisclosureType[]>>('/disclosures/types')
      .then((r) => r.data.data),

  getList: (page = 1, limit = 20, disclosureType?: string, watchlistOnly?: boolean, keywords?: string[]) =>
    api
      .get<ApiResponse<Disclosure[]>>('/disclosures', {
        params: {
          page,
          limit,
          ...(disclosureType && { disclosureType }),
          ...(watchlistOnly && { watchlistOnly: true }),
          ...(keywords && keywords.length > 0 && { keywords: keywords.join(',') }),
        },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  getDetail: (rcpNo: string) =>
    api.get<ApiResponse<Disclosure>>(`/disclosures/${rcpNo}`).then((r) => r.data.data),

  search: (q: string, page = 1, disclosureType?: string) =>
    api
      .get<ApiResponse<Disclosure[]>>('/disclosures/search', {
        params: { q, page, ...(disclosureType && { disclosureType }) },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  /** 공시 AI 이벤트 분석 결과 (실연동 — GET /disclosure-events/:rcpNo) */
  getEvent: (rcpNo: string) =>
    api
      .get<DisclosureEvent>(`/disclosure-events/${rcpNo}`)
      .then((r) => r.data)
      .catch(() => null),
};
