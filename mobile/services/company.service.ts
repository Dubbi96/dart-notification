import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';
import type { Company } from '@app-types/user.types';

export const companyService = {
  search: (query: string) =>
    api
      .get<ApiResponse<Company[]>>('/companies/search', { params: { query } })
      .then((r) => r.data.data),

  getByCorpCode: (corpCode: string) =>
    api
      .get<ApiResponse<Company>>(`/companies/${corpCode}`)
      .then((r) => r.data.data),
};
