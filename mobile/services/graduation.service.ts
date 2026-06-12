import type { ApiResponse } from '@app-types/api.types';
import type { FunnelReport, GraduationReport } from '@app-types/graduation.types';

import { api } from './api';

// 졸업 게이트 측정 조회 — DAR-67 / 신호→진입 퍼널 — DAR-162(DAR-109 소비).
// OptionalJwt(게스트 데모 가능, 단일 시스템 모의 포트폴리오). 컴포넌트 직접 fetch 금지: 훅으로만 소비.
export const graduationService = {
  getMetrics: () =>
    api
      .get<ApiResponse<GraduationReport>>('/graduation/metrics')
      .then((r) => r.data.data),
  // 신호→진입 퍼널(GET /graduation/funnel) — 일별·누적 전환율. DAR-162.
  getFunnel: () =>
    api
      .get<ApiResponse<FunnelReport>>('/graduation/funnel')
      .then((r) => r.data.data),
};
