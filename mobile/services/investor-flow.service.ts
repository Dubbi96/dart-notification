import type { ApiResponse } from '@app-types/api.types';
import type { InvestorFlowResult, ShortSellingResult } from '@app-types/investor-flow.types';

import { api } from './api';

/**
 * 수급·공매도 조회 서비스 (갭분석 W16, read-only). 게스트 열람 가능(OptionalJwtAuthGuard).
 * 백엔드 GET /market-data/investor-flow · /market-data/short-selling 과 1:1.
 * 6자리 코드가 아니면 네트워크 호출 없이 빈 결과(asOfDate=null) graceful — 소비측 카드 억제.
 */
export const investorFlowService = {
  /** 종목 투자자별 매매동향 — 최근 days 거래일 + 5/20일 누적 요약. */
  getInvestorFlow: (stockCode: string, days = 20): Promise<InvestorFlowResult> => {
    if (!/^\d{6}$/.test(stockCode)) {
      return Promise.resolve({ stockCode, asOfDate: null, rows: [], summary: null });
    }
    return api
      .get<ApiResponse<InvestorFlowResult>>('/market-data/investor-flow', {
        params: { stockCode, days },
      })
      .then((r) => r.data.data);
  },

  /** 종목 공매도 일별 — 최근 days 거래일(잔고 미가용 시 거래비중 shortVolumeRatio 로 대체 표기). */
  getShortSelling: (stockCode: string, days = 20): Promise<ShortSellingResult> => {
    if (!/^\d{6}$/.test(stockCode)) {
      return Promise.resolve({ stockCode, asOfDate: null, rows: [] });
    }
    return api
      .get<ApiResponse<ShortSellingResult>>('/market-data/short-selling', {
        params: { stockCode, days },
      })
      .then((r) => r.data.data);
  },
};
