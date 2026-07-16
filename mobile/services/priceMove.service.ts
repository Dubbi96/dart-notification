import type { ApiResponse } from '@app-types/api.types';
import type { PriceMoveReasoning } from '@app-types/priceMove.types';

import { api } from './api';

// PRICE_MOVE 역방향 리즈닝 조회 서비스 (DAR-524, Wave C/C2).
// C1(DAR-522)이 등락 이벤트 refId(`<stockCode>-<YYYYMMDD>`)당 1행으로 멱등 저장한
// price_move_reasonings 를 '왜 움직였나' 카드가 조회 소비한다. 읽기 전용.
export const priceMoveService = {
  /** GET /price-move-reasonings/:refId — 등락 이벤트 refId 로 역방향 리즈닝 1건. */
  getReasoning: (refId: string) =>
    api
      .get<ApiResponse<PriceMoveReasoning>>(
        `/price-move-reasonings/${encodeURIComponent(refId)}`,
      )
      .then((r) => r.data.data),
};
