// 포트폴리오·포지션·Thesis·모의투자 도메인 타입 계약.
// ⚠️ 포지션/포트폴리오/모의투자 엔드포인트는 아직 미존재(DAR-22).
// 계약을 고정하고, 실제 응답이 생기면 그대로 연동한다.

import type { ExitAction } from '@app-types/signal.types';

export type ThesisStatus = 'ACTIVE' | 'WATCHING' | 'VIOLATED' | 'EXPIRED';

/** 보유 포지션 */
export interface Position {
  id: string;
  portfolioId: string;
  corpCode: string;
  corpName: string;
  ticker?: string;
  /** 손익률(%) */
  pnlPercent: number;
  thesisStatus: ThesisStatus;
  quantity?: number;
  avgPrice?: number;
  currentPrice?: number;
  /** 매도 시급도 점수 0~100 (없으면 큐레이션 대상 제외) */
  exitScore?: number;
  /** 권장 액션 */
  exitAction?: ExitAction;
  /** 점검 이유 1줄 (예: "논거 훼손: 매출 가이던스 하향") */
  checkReason?: string;
  /** 포트폴리오 내 비중 % */
  weight?: number;
}

/** 포트폴리오 요약(실전) */
export interface PortfolioSummary {
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  mddPercent?: number;
  /** 오늘 손실 한도 잔여(%) */
  dailyLossLimitRemaining?: number;
  /** MDD/손실 한도 초과 경고 */
  mddBreached?: boolean;
}

/**
 * 포트폴리오 리스크 스냅샷(DAR-163) — `GET /portfolio/risk/latest`.
 * 일손익·집중도·하드룰 위반·riskLevel. 스냅샷 부재 시 응답 data 는 null.
 */
export type PortfolioRiskLevel = 'NORMAL' | 'WARNING' | 'CRITICAL' | string;

export interface PortfolioRiskSnapshot {
  portfolioId: string;
  /** YYYY-MM-DD */
  snapshotDate: string;
  totalValue: number;
  cashAmount: number | null;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  /** 최대 단일 종목 비중 % (집중도) */
  topPositionPct: number;
  topSectorPct: number | null;
  openPositionCount: number;
  /** 당일 손익(금액) */
  dailyPnl: number | null;
  /** 당일 손익률 % */
  dailyPnlPct: number | null;
  weeklyPnl: number | null;
  weeklyPnlPct: number | null;
  riskLevel: PortfolioRiskLevel;
  hardRuleBreached: boolean;
  hardRuleDetail: string | null;
}

/** Thesis 진입 논리 / 훼손 조건 항목 */
export interface ThesisCondition {
  id: string;
  label: string;
  /** 훼손 조건의 경우 위반 여부, 진입 논리의 경우 충족 여부 */
  violated: boolean;
}

/** 청산 룰(읽기 전용 — 시스템 관리 안전 한도) */
export interface ExitRule {
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  maxHoldingDays: number;
}

/** Position Thesis 상세 */
export interface PositionThesis {
  positionId: string;
  corpName: string;
  personaType?: string;
  status: ThesisStatus;
  entryLogic: ThesisCondition[];
  violationConditions: ThesisCondition[];
  exitRules: ExitRule;
  triggerDisclosureRcpNo?: string;
}

/** 모의투자 체결 이력 */
export interface PaperTrade {
  id: string;
  /** ISO 8601 */
  date: string;
  corpName: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
}

/** 모의투자 포트폴리오 */
export interface PaperPortfolio {
  totalAsset: number;
  totalPnl: number;
  totalPnlPercent: number;
  /** ISO 8601 — 시작일 */
  startedAt: string;
  elapsedDays: number;
  /** 신호 적중률 0~1 */
  signalHitRate?: number;
  signalHitCount?: number;
  signalTotalCount?: number;
  avgHoldingDays?: number;
  positions: Position[];
  trades: PaperTrade[];
  /** 모의투자 시작 여부 */
  started: boolean;
}

// ====================================
// 오늘의 브리핑 (W14) — GET /portfolio/briefing/today
// LLM $0 룰 기반 결합 표면: 수치·문구 전부 서버 룰 렌더링(신규 AI 호출 0).
// 계약: 섹션별 0건이면 해당 섹션 null, 전 섹션 0건이면 응답 data 자체가 null.
// ====================================

/** 브리핑 이벤트 항목의 종목 출처 — 보유 포지션 vs 관심종목. */
export type BriefingSourceType = 'POSITION' | 'WATCHLIST';

/** 당일 공시 이벤트 1건 — 공시 상세(/disclosure/{rcpNo}) 딥링크 대상. */
export interface BriefingEventItem {
  rcpNo: string;
  corpCode: string;
  corpName: string;
  reportName: string;
  eventType: string;
  polarity: string;
  /** 캐시된 AI 요약 1줄(공시 카드 요약 재사용). 캐시 없으면 null. */
  summaryLine: string | null;
  source: BriefingSourceType;
}

/** 일간 손익 — PositionDailySnapshot 최신·직전 시점 차분(서버 집계). */
export interface BriefingPnlSection {
  /** 데이터 기준 거래일 'YYYYMMDD' (freshness 정직 표기). */
  snapshotDate: string;
  dailyPnl: number;
  /** 분모(전일 평가금액) 산출 불가 시 null — 0% 위장 금지. */
  dailyPnlPct: number | null;
  positionCount: number;
}

/** 점검 필요 포지션 1건 — 포지션 상세 딥링크 대상. */
export interface BriefingCheckItem {
  positionId: string;
  portfolioId: string;
  corpCode: string;
  corpName: string;
  thesisStatus: ThesisStatus;
  exitScore: number | null;
  exitAction: string | null;
  /** ExitSignal 점검 시각(ISO). thesis 사유만이면 null. */
  checkedAt: string | null;
  /** 점검 이유 1줄(서버 룰 렌더링). */
  reason: string;
}

/** 오늘의 브리핑 응답. */
export interface TodayBriefing {
  /** KST 기준일 'YYYY-MM-DD'. */
  dateKst: string;
  /** 조립 시각(ISO) — 데이터 기준 시각. */
  asOf: string;
  events: BriefingEventItem[] | null;
  dailyPnl: BriefingPnlSection | null;
  checks: BriefingCheckItem[] | null;
  /** 리스크 스냅샷 — 화면에선 PortfolioRiskBadge가 전담하므로 브리핑 섹션은 미렌더(중복 금지). */
  risk: PortfolioRiskSnapshot | null;
}
