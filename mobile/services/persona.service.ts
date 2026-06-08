import type { ApiResponse } from '@app-types/api.types';
import type { MarketRegime, PersonaOverview } from '@app-types/persona.types';

import { api } from './api';

// persona별 모의운용 성과 + 현재 장 적합 persona 추천 조회 — DAR-131 / DAR-130.
// OptionalJwt 엔드포인트(게스트 데모 가능). 컴포넌트 직접 fetch 금지: 훅으로만 소비.
// ★ read-only — 실주문/자동매매 없음. 추천 판단은 백엔드 순수 Rule(AI 금지영역 불가침).
export const personaService = {
  // persona별 성과 + 현재 장 추천 종합.
  getOverview: () =>
    api
      .get<ApiResponse<PersonaOverview>>('/paper-trading/personas')
      .then((r) => r.data.data),

  // 현재 시장 레짐만(추천 근거 단독 노출용).
  getRegime: () =>
    api
      .get<ApiResponse<MarketRegime>>('/paper-trading/personas/regime')
      .then((r) => r.data.data),
};
