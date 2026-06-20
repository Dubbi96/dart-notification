import type { ApiResponse } from '@app-types/api.types';
import type { SignalAccuracyReport } from '@app-types/signal-accuracy.types';
import type { CalibrationReport } from '@app-types/calibration.types';
import type { BacktestTrackRecord } from '@app-types/backtest.types';

import { api } from './api';

// 신호 사후검증 백테스트 조회 — DAR-73 / DAR-92.
// OptionalJwt(게스트 데모 가능). read-only 집계 — 컴포넌트 직접 fetch 금지: 훅으로만 소비.
export const backtestService = {
  // 등급·스코어구간·eventType 별 D+5/D+20 실현 초과수익 정밀도.
  getSignalAccuracy: () =>
    api
      .get<ApiResponse<SignalAccuracyReport>>('/backtest/signal-accuracy')
      .then((r) => r.data.data),

  // 신호 보정 루프 리포트(DAR-83·DAR-91): 실현 초과수익 vs EVENT_BASE_SCORES 괴리·권장 delta·
  // 등급별 confidence 보정계수. ★ diff 형 권고만 — 자동반영 없음(상수 변경은 사람 PR).
  getCalibration: () =>
    api
      .get<ApiResponse<CalibrationReport>>('/backtest/calibration')
      .then((r) => r.data.data),

  // 1년 자동매매 point-in-time 리플레이 트랙레코드(DAR-385) — 최신 완료본.
  // OptionalJwt(게스트 데모 가능). 미완료/미실행이면 data=null 로 graceful(빈 상태 표시).
  getTrackRecord: () =>
    api
      .get<ApiResponse<BacktestTrackRecord | null>>('/backtest/track-record')
      .then((r) => r.data.data),
};
