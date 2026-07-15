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

  /**
   * 미국 주식 알림 수요 기록 (검색 빈 상태 원탭 버튼 — 계측 전용, 기능 약속 아님).
   * 탭 시점의 검색어(q)를 함께 보내 수요 맥락을 보존한다.
   */
  recordUsDemand: (q?: string) =>
    api.post('/search/us-demand', { ...(q ? { q } : {}) }).then(() => undefined),
};
