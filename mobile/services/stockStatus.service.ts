import type { ApiResponse } from '@app-types/api.types';
import type { StockRiskStatus } from '@app-types/stock-status.types';

import { api } from './api';

/**
 * 종목 위험상태 조회 서비스 (DAR-99, read-only). 게스트 열람 가능(OptionalJwtAuthGuard).
 * corpCode 또는 stockCode 로 관리종목·거래정지·상폐위험(DART 공시 폴백·근사값)을 조회한다.
 */
export const stockStatusService = {
  /** 종목 위험상태 1건. 위험 없으면 모든 플래그 false. */
  getRiskStatus: (params: { corpCode?: string; stockCode?: string }) =>
    api
      .get<ApiResponse<StockRiskStatus>>('/stock-status/risk', {
        params: {
          ...(params.corpCode && { corpCode: params.corpCode }),
          ...(params.stockCode && { stockCode: params.stockCode }),
        },
      })
      .then((r) => r.data.data),
};
