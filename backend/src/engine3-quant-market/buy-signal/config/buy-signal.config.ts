/**
 * Buy Score 가중치 및 설정 — 변경 추적 가능하도록 상수로 분리
 * AI 금지영역: 이 설정값은 순수 Rule 기반. AI/LLM이 동적으로 변경 절대 금지.
 */

// DAR-88: 내부자/대량보유(insider) 버킷 신설로 8버킷 체계.
//   기존 7버킷은 (1 - INSIDER_WEIGHT) 배로 일괄 축소해 상대 비율을 보존한다.
//   insider 데이터가 결측인 종목(대부분의 과거 백테스트/스냅샷)은 bucket-renormalization
//   이 insider 를 분모에서 제외 → 가용 가중치를 (1 - INSIDER_WEIGHT) 로 나눠 기존 7버킷
//   가중치를 정확히 복원하므로 점수 회귀가 0이다(임계값 80/60/30 불변).
const INSIDER_WEIGHT = 0.05; // W8: 내부자·대량보유 동향 (marketSector 와 동급 보조신호)
const LEGACY_SCALE = 1 - INSIDER_WEIGHT;

export const BUY_SCORE_WEIGHTS = {
  disclosureEvent: 0.25 * LEGACY_SCALE, // W1: 공시 이벤트 점수
  keyMetric:       0.20 * LEGACY_SCALE, // W2: 핵심 수치 점수
  personaFit:      0.15 * LEGACY_SCALE, // W3: Persona 적합도
  historicalEvent: 0.10 * LEGACY_SCALE, // W4: 과거 유사 공시 성과 (Phase 9 미완 시 0)
  chart:           0.15 * LEGACY_SCALE, // W5: 차트 점수
  volumeLiquidity: 0.10 * LEGACY_SCALE, // W6: 거래량·수급 점수
  marketSector:    0.05 * LEGACY_SCALE, // W7: 시장·업종 분위기
  insider:         INSIDER_WEIGHT,      // W8: 내부자 순매수 가점·대량매도 감점 (결측 시 재정규화 제외)
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
