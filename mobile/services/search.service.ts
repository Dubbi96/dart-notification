import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';
import type { UnifiedSearchResult } from '@app-types/search.types';

export const searchService = {
  /** 통합 검색 (기업+공시 카테고리 묶음). */
  unified: (q: string, companyLimit?: number, disclosureLimit?: number) =>
    api
      .get<ApiResponse<UnifiedSearchResult>>('/search', {
        params: {
          q,
          ...(companyLimit && { companyLimit }),
          ...(disclosureLimit && { disclosureLimit }),
        },
      })
      .then((r) => r.data.data),
};
