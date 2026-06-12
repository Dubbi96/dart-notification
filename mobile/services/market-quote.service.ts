import type { ApiResponse } from '@app-types/api.types';
import type { StockQuoteMap } from '@app-types/market-quote.types';

import { api } from './api';

/**
 * 종목 최신 시세 조회 서비스 (DAR-158, read-only). 게스트 열람 가능(OptionalJwtAuthGuard).
 * 다건 종목코드를 콤마구분으로 보내 단일 in 쿼리로 조회(N+1 회피). 데이터 없는 종목은 null.
 */
export const marketQuoteService = {
  /** 다건 종목 최신 시세. 빈 입력이면 네트워크 호출 없이 빈 맵. */
  getQuotes: (stockCodes: string[]): Promise<StockQuoteMap> => {
    const codes = stockCodes.filter((c) => /^\d{6}$/.test(c));
    if (codes.length === 0) return Promise.resolve({});
    return api
      .get<ApiResponse<StockQuoteMap>>('/market-data/quote', {
        params: { stockCodes: codes.join(',') },
      })
      .then((r) => r.data.data);
  },
};
