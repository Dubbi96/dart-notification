import type { ApiResponse } from '@app-types/api.types';
import type { SignalAccuracyReport } from '@app-types/signal-accuracy.types';

import { api } from './api';

// 신호 사후검증 백테스트 조회 — DAR-73.
// OptionalJwt(게스트 데모 가능). read-only 집계 — 컴포넌트 직접 fetch 금지: 훅으로만 소비.
export const backtestService = {
  // 등급·스코어구간·eventType 별 D+5/D+20 실현 초과수익 정밀도.
  getSignalAccuracy: () =>
    api
      .get<ApiResponse<SignalAccuracyReport>>('/backtest/signal-accuracy')
      .then((r) => r.data.data),
};
