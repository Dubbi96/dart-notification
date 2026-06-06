import type { ApiResponse } from '@app-types/api.types';
import type { FinancialSnapshot } from '@app-types/financial.types';

import { api } from './api';

/** 재무지표 조회 서비스 (DAR-96, read-only). 게스트 열람 가능(OptionalJwtAuthGuard). */
export const financialsService = {
  /** 기업 최신 재무지표 1건. 없으면 data=null. */
  getLatest: (corpCode: string, fsDiv?: string) =>
    api
      .get<ApiResponse<FinancialSnapshot | null>>('/financials/latest', {
        params: { corpCode, ...(fsDiv && { fsDiv }) },
      })
      .then((r) => r.data.data),
};
