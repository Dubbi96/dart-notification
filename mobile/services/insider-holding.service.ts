import type { ApiResponse } from '@app-types/api.types';
import type {
  InsiderHoldingChange,
  InsiderHoldingsQuery,
} from '@app-types/insider-holding.types';

import { api } from './api';

/** 내부자/대량보유 지분변동 조회 서비스 (DAR-88, read-only). */
export const insiderHoldingService = {
  list: (query: InsiderHoldingsQuery = {}) =>
    api
      .get<ApiResponse<InsiderHoldingChange[]>>('/insider-holdings', {
        params: {
          ...(query.corpCode && { corpCode: query.corpCode }),
          ...(query.tradeType && { tradeType: query.tradeType }),
          ...(query.source && { source: query.source }),
          ...(query.from && { from: query.from }),
          ...(query.to && { to: query.to }),
          ...(query.page && { page: query.page }),
          ...(query.limit && { limit: query.limit }),
        },
      })
      .then((r) => r.data.data),
};
