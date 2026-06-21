import type { ApiResponse } from '@app-types/api.types';
import type { EquityCurve, SimulationStatus } from '@app-types/simulation.types';
import type { TradeHistory } from '@app-types/trade-rationale.types';
import type { StyleComparison } from '@app-types/style-comparison.types';
import type {
  StrategyComparison,
  StrategyKey,
  StrategyTradeHistory,
} from '@app-types/strategy-comparison.types';

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

  // 매매 사유 추적 + 성적표 — OptionalJwt(게스트 데모 가능). DAR-64.
  getTradeHistory: () =>
    api
      .get<ApiResponse<TradeHistory>>('/paper-trading/simulation/trade-history')
      .then((r) => r.data.data),

  // 철학 스타일별 성과 비교 — OptionalJwt(게스트 데모 가능). DAR-76.
  getStyleComparison: () =>
    api
      .get<ApiResponse<StyleComparison>>('/paper-trading/simulation/styles/comparison')
      .then((r) => r.data.data),

  // 시스템 트레이딩 전략 변형 4종 비교 — OptionalJwt(게스트 데모 가능). DAR-405(BE: DAR-404).
  getStrategyComparison: () =>
    api
      .get<ApiResponse<StrategyComparison>>('/paper-trading/simulation/strategies/comparison')
      .then((r) => r.data.data),

  // 전략별 과거 매수/매도 타임라인(BacktestTrade) — OptionalJwt. DAR-405(BE: DAR-404).
  getStrategyTradeHistory: (key: StrategyKey) =>
    api
      .get<ApiResponse<StrategyTradeHistory>>(
        `/paper-trading/simulation/strategies/${key}/trade-history`,
      )
      .then((r) => r.data.data),
};
