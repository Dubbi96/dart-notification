import type { ApiResponse } from '@app-types/api.types';
import type { MarketIndexQuote } from '@app-types/market.types';

import { api } from './api';

/**
 * 시장지수 조회 서비스 (DAR-160, read-only). 게스트 열람 가능(OptionalJwtAuthGuard).
 * KOSPI·KOSDAQ 최신 종가·전일대비 등락률을 홈 헤더 '시장 한눈에' 배지에 노출한다.
 */
export const marketService = {
  /** 시장지수 최신값 목록(KOSPI·KOSDAQ). 미적재 지수는 생략될 수 있다. */
  getLatestIndices: () =>
    api
      .get<ApiResponse<MarketIndexQuote[]>>('/market-data/indices/latest')
      .then((r) => r.data.data ?? []),
};
