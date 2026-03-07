import { api } from './api';
import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type { Disclosure } from '@app-types/disclosure.types';

export const disclosureService = {
  getList: (page = 1, limit = 20) =>
    api
      .get<ApiResponse<Disclosure[]>>('/disclosures', { params: { page, limit } })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  getDetail: (id: string) =>
    api.get<ApiResponse<Disclosure>>(`/disclosures/${id}`).then((r) => r.data.data),

  search: (query: string, page = 1) =>
    api
      .get<ApiResponse<Disclosure[]>>('/disclosures/search', { params: { query, page } })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),
};
