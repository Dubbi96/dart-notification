// 수집 상태 대시보드 도메인 타입 계약 — DAR-63.
// GET /api/collection/status 응답과 1:1. 백엔드 CollectionStatusDto 와 동기화.

/** 수집 성숙도 배지 — 충분/수집중/대기 */
export type CollectionMaturity = 'SUFFICIENT' | 'COLLECTING' | 'WAITING';

/** 수집 실행 상태 — 로그 부재 시 null */
export type CollectionRunStatus =
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL'
  | 'FAILED'
  | null;

/** 공시 수집 커버리지 */
export interface DisclosureCoverage {
  /** 누적 공시 건수 */
  totalCount: number;
  /** 최근 수집 실행 시각(ISO). 로그 없으면 null */
  lastCollectedAt: string | null;
  /** 최근 수집 실행 신규 저장 건수 */
  lastNewCount: number;
  /** 최근 수집 실행 상태 */
  lastStatus: CollectionRunStatus;
  maturity: CollectionMaturity;
}

/** 재무 수집 커버리지 */
export interface FinancialCoverage {
  /** 재무 데이터 보유 종목 수 */
  coveredCompanies: number;
  /** 최근 보유 분기('사업연도 / 보고서코드'). 없으면 null */
  latestPeriod: string | null;
  lastCollectedAt: string | null;
  lastStatus: CollectionRunStatus;
  maturity: CollectionMaturity;
}

/** 시세/지표 수집 커버리지 */
export interface IndicatorCoverage {
  /** 지표 백필 완료 종목 수 */
  coveredStocks: number;
  /** 최근 지표 기준 거래일 YYYYMMDD. 없으면 null */
  latestTradeDate: string | null;
  lastCollectedAt: string | null;
  lastStatus: CollectionRunStatus;
  maturity: CollectionMaturity;
}

/** 모의운용 커버리지 */
export interface SimulationCoverage {
  /** 보유(OPEN) 포지션 수 */
  openPositions: number;
  /** 누적 모의 체결 건수 */
  totalTrades: number;
  /** 최근 모의 체결 시각(ISO). 없으면 null */
  lastTradeAt: string | null;
  maturity: CollectionMaturity;
}

/** 수집 현황 집계 응답 */
export interface CollectionStatus {
  disclosure: DisclosureCoverage;
  financial: FinancialCoverage;
  indicator: IndicatorCoverage;
  simulation: SimulationCoverage;
  /** 집계 생성 시각(ISO) */
  generatedAt: string;
}
