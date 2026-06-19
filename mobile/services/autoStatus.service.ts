import type { ApiResponse } from '@app-types/api.types';
import type { AutoTradingStatus } from '@app-types/auto-status.types';

import { api } from './api';

// 자동매매 실행상태(읽기전용 투명성) 조회 — DAR-361.
// 킬스위치·리스크게이트·최근 주문을 read-only 로 조회. OptionalJwt(게스트 데모 조회 가능,
// 단일 시스템 모의 포트폴리오). 컴포넌트 직접 fetch 금지: 훅으로만 소비.
export const autoStatusService = {
  getStatus: (recentLimit = 3) =>
    api
      .get<ApiResponse<AutoTradingStatus>>('/trading/auto-status', {
        params: { recentLimit },
      })
      .then((r) => r.data.data),
};
