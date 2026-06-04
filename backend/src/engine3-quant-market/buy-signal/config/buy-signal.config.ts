/**
 * Buy Score 가중치 및 설정 — 변경 추적 가능하도록 상수로 분리
 * AI 금지영역: 이 설정값은 순수 Rule 기반. AI/LLM이 동적으로 변경 절대 금지.
 */

export const BUY_SCORE_WEIGHTS = {
  disclosureEvent: 0.25, // W1: 공시 이벤트 점수
  keyMetric:       0.20, // W2: 핵심 수치 점수
  personaFit:      0.15, // W3: Persona 적합도
  historicalEvent: 0.10, // W4: 과거 유사 공시 성과 (Phase 9 미완 시 0)
  chart:           0.15, // W5: 차트 점수
  volumeLiquidity: 0.10, // W6: 거래량·수급 점수
  marketSector:    0.05, // W7: 시장·업종 분위기
} as const;

// 가중치 합 = 1.0 (서버 시작 시 검증)
export const WEIGHT_SUM = Object.values(BUY_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

export const EVENT_BASE_SCORES: Record<string, number> = {
  SUPPLY_CONTRACT:           70,
  SHARE_BUYBACK:             65,
  SHARE_CANCELLATION:        80,
  DIVIDEND_INCREASE:         60,
  EARNINGS_SURPRISE:         75,
  PAID_IN_CAPITAL_INCREASE: -50,
  THIRD_PARTY_ALLOTMENT:    -60,
  CB_ISSUANCE:              -40,
  BW_ISSUANCE:              -35,
  EARNINGS_SHOCK:           -80,
  CONTRACT_CANCELLATION:    -70,
  AUDIT_OPINION_RISK:       -90,
  TRADING_SUSPENSION:      -100,
  DELISTING_RISK:          -100,
  LAWSUIT:                  -30,
  MAJOR_SHAREHOLDER_CHANGE:  10,
};

export const PERSONA_TYPES = ['GROWTH', 'VALUE', 'MOMENTUM', 'EVENT_DRIVEN'] as const;
export type PersonaType = typeof PERSONA_TYPES[number];

export const VIEW_SCORE: Record<string, number> = {
  POSITIVE: 100,
  WATCH:     40,
  NEUTRAL:    0,
  NEGATIVE: -60,
};

export const SIGNAL_GRADE_THRESHOLDS = {
  STRONG_BUY_CANDIDATE: 80,
  BUY_CANDIDATE:        60,
  WATCH:                30,
  NEUTRAL:             -29,
  // below -29 → AVOID
} as const;
