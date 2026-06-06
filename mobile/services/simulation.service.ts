import type { ApiResponse } from '@app-types/api.types';
import type { EquityCurve, SimulationStatus } from '@app-types/simulation.types';

import { api } from './api';

// 모의운용(서버 시뮬) 현황 조회 — DAR-42 / DAR-60.
// JWT 가드 엔드포인트(로그인/게스트 토큰으로 호출). 컴포넌트 직접 fetch 금지: 훅으로만 소비.
export const simulationService = {
  getStatus: () =>
    api
      .get<ApiResponse<SimulationStatus>>('/paper-trading/simulation/status')
      .then((r) => r.data.data),

  // 자산곡선 + 졸업 진척 — OptionalJwt(게스트 데모 가능). DAR-60.
  getEquityCurve: () =>
    api
      .get<ApiResponse<EquityCurve>>('/paper-trading/simulation/equity-curve')
      .then((r) => r.data.data),
};
