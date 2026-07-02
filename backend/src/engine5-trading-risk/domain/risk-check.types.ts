// Engine5 — Risk 하드룰 타입 정의 (M11, DAR-18)
// AI 금지영역: Risk 판정은 순수 Rule. AI 개입 0.

export interface RiskCheckInput {
  corpCode: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  requestedShares: number;
  limitPrice: number;           // 기준가 (시장가 추정 또는 지정가)

  // 포트폴리오 스냅샷 (판정 시점)
  totalCapital: number;         // 총자산 (KRW)
  currentPositionValue: number; // 해당 종목 현재 포지션 평가금액
  dailyPnl: number;             // 오늘 실현+미실현 손익 (음수 = 손실)
  weeklyPnl: number;            // 이번주 손익 (음수 = 손실)

  // 중복·과매매 방지용
  openOrderCount: number;       // 미체결 주문 수
  todayTradeCount: number;      // 오늘 체결 수

  // Kill Switch 상태
  killSwitchActive: boolean;

  // (선택) Buy Score — Risk veto 증적용. AI가 긍정이어도 Rule 위반이면 거부.
  buyScore?: number;
}

export type RiskViolationCode =
  | 'KILL_SWITCH_ACTIVE'      // Kill Switch 발동 중
  | 'SINGLE_BUY_LIMIT'        // 1회 매수 한도 초과 (자본 3%)
  | 'SINGLE_POSITION_LIMIT'   // 단일 종목 한도 초과 (자본 10%)
  | 'DAILY_LOSS_LIMIT'        // 일간 손실 한도 초과 (-2%)
  | 'WEEKLY_LOSS_LIMIT'       // 주간 손실 한도 초과 (-5%)
  | 'DUPLICATE_ORDER'         // 중복 주문 (미체결 주문 존재)
  | 'OVER_TRADING';           // 과매매 (일간 최대 거래 횟수 초과)

export interface RiskViolation {
  code: RiskViolationCode;
  message: string;
  details?: Record<string, number | string>;
}

export interface RiskCheckResult {
  approved: boolean;
  violations: RiskViolation[];
  // Risk veto 증적: AI가 긍정이어도 Rule 위반 시 거부
  vetoed: boolean;
  vetoReason?: string;
}

// 하드룰 파라미터 (조정 가능)
export interface RiskLimits {
  singleBuyMaxPct: number;     // 1회 매수 최대 비율 (기본 0.03 = 3%)
  singlePositionMaxPct: number; // 단일 종목 최대 비율 (기본 0.10 = 10%)
  dailyLossMaxPct: number;     // 일간 손실 한도 (기본 -0.02 = -2%, 음수)
  weeklyLossMaxPct: number;    // 주간 손실 한도 (기본 -0.05 = -5%, 음수)
  maxOpenOrders: number;       // 최대 미체결 주문 수 (기본 5)
  maxDailyTrades: number;      // 일간 최대 거래 횟수 (기본 10)
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  singleBuyMaxPct: 0.03,
  singlePositionMaxPct: 0.10,
  dailyLossMaxPct: -0.02,
  weeklyLossMaxPct: -0.05,
  maxOpenOrders: 5,
  maxDailyTrades: 10,
};

// GAP-11: Kill Switch 모드 — 스키마 동결(웨이브1)로 KillSwitchState DB 컬럼 대신 코드 상수 기본 정책.
//   REDUCE_ONLY(기본): 발동 중 신규 진입(BUY) 차단, 위험 축소(SELL·청산)는 허용.
//   FULL_HALT: 발동 중 모든 주문 차단(전면 중단 — 필요 시 상수 교체로 전환).
// 순수 Rule — AI 개입 0.
export type KillSwitchMode = 'REDUCE_ONLY' | 'FULL_HALT';

export const DEFAULT_KILL_SWITCH_MODE: KillSwitchMode = 'REDUCE_ONLY';

// Kill Switch 자동 발동 조건
export interface AutoKillConditions {
  consecutiveLossCount: number;    // 연속 손실 횟수
  maxConsecutiveLoss: number;      // 임계값 (기본 5회)
  marketDropPct: number;           // 시장 급락율 (음수, 기본 -0.05 = -5%)
  apiErrorCount: number;           // API 오류 횟수
  maxApiErrors: number;            // 임계값 (기본 3회)
}

export const DEFAULT_AUTO_KILL_CONDITIONS: AutoKillConditions = {
  consecutiveLossCount: 0,
  maxConsecutiveLoss: 5,
  marketDropPct: 0,
  maxApiErrors: 3,
  apiErrorCount: 0,
};

// M12 자동매매 게이트용 이벤트 분류
export type EventKind =
  // 화이트리스트 (6종) — 자동매매 허용
  | 'EARNINGS_BEAT'           // 실적 서프라이즈 (예상 초과)
  | 'REVENUE_GROWTH'          // 매출 성장
  | 'NEW_CONTRACT'            // 신규 계약·수주
  | 'DIVIDEND_INCREASE'       // 배당 증가
  | 'SHARE_BUYBACK'           // 자사주 매입
  | 'MANAGEMENT_BUYOUT'       // 경영진 자사주 매입
  // 블랙리스트 (9종) — 자동매매 차단
  | 'ACCOUNTING_FRAUD'        // 회계 부정
  | 'REGULATORY_ACTION'       // 규제 제재
  | 'DELISTING_RISK'          // 상장폐지 위험
  | 'MAJOR_LITIGATION'        // 중대 소송
  | 'EARNINGS_MISS'           // 실적 쇼크
  | 'DIVIDEND_CUT'            // 배당 삭감
  | 'CAPITAL_REDUCTION'       // 감자
  | 'MANAGEMENT_SCANDAL'      // 경영진 스캔들
  | 'TRADING_SUSPENSION';     // 거래정지 위험

export interface EventGateResult {
  eventKind: EventKind;
  allowed: boolean;           // true = 화이트리스트, false = 블랙리스트
  reason: string;
}
