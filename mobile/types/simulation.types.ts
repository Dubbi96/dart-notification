// 모의운용(서버 시뮬) 상태 도메인 타입 계약 — DAR-42.
// GET /api/paper-trading/simulation/status 응답과 1:1.
// 백엔드 PaperSimulationService.getSimulationStatus / SimulationMetrics 와 동기화.

/** 모의운용 보유 포지션 1행(종목·수량·평가손익) */
export interface SimPosition {
  corpCode: string;
  stockCode: string;
  /** 회사명(없으면 null — 종목코드로 대체 표시) */
  corpName: string | null;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  /** 평가금액(원) */
  currentValue: number;
  /** 평가손익(원) */
  unrealizedPnl: number;
  /** 평가손익률(%) */
  unrealizedPnlPct: number;
}

/** go/no-go 게이트 통과 여부(표본 부족 시 null — 정직 표기) */
export interface SimulationGates {
  hitRatePass: boolean | null;
  cumulativeReturnPass: boolean;
  exitAccuracyPass: boolean | null;
  aiCostRatioPass: boolean | null;
}

/** 누적 졸업지표 */
export interface SimulationMetrics {
  /** 신호 적중률(0~1). 표본 0이면 null */
  hitRateD5: number | null;
  hitRateSampleSize: number;
  /** 모의 누적 수익률(%) */
  cumulativeReturnPct: number;
  /** 총 모의 순익(원) = 실현 + 미실현 */
  netPnl: number;
  /** Exit 정확도(0~1). 표본 0이면 null */
  exitAccuracyD3: number | null;
  exitAccuracySampleSize: number;
  /** AI비용/모의순익 비율. 순익 ≤ 0이면 측정 불가(null) */
  aiCostToNetPnlRatio: number | null;
  gates: SimulationGates;
}

/** 모의운용 현황 응답 */
export interface SimulationStatus {
  portfolioId: string;
  /** 초기 가상원금(원) */
  initialCapital: number;
  /** 현재 평가금액(원) */
  equity: number;
  /** 보유 포지션 수 */
  openPositionCount: number;
  /** 보유 포지션 상세 */
  positions: SimPosition[];
  /** 청산(종료) 포지션 수 */
  closedPositions: number;
  /** 최신 일일 스냅샷일(YYYYMMDD) — 아직 사이클 미실행이면 null */
  latestSnapshotDate: string | null;
  metrics: SimulationMetrics;
}
