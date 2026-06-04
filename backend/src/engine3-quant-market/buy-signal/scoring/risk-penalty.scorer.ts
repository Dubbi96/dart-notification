/**
 * 리스크 패널티 계산
 * 하드 차단 조건 → Infinity 반환 (신호 BLOCKED 처리)
 * 누적 패널티 → 양수값 (Buy Score에서 차감)
 * AI 금지영역: 순수 Rule 함수. AI/LLM 개입 절대 금지.
 */

export interface RiskPenaltyInput {
  eventType: string;
  isAmendment: boolean;
  preDsclReturn: number | null; // 공시 전 선행상승률 D-5~D-1 (%)
  isTradingSuspended: boolean;
  isManagement: boolean;       // 관리종목
  isInvestmentCaution: boolean; // 투자주의
  isAbnormalSurge: boolean;    // 이상급등
  dilutionRate: number | null; // PAID_IN_CAPITAL_INCREASE 희석률 (%)
  avgDailyVolume: number | null; // 저유동성 판단용
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const HARD_BLOCK_EVENT_TYPES = new Set([
  'AUDIT_OPINION_RISK',
  'TRADING_SUSPENSION',
  'DELISTING_RISK',
]);

export function scoreRiskPenalty(input: RiskPenaltyInput): number {
  // 하드 차단 → Infinity (신호 BLOCKED)
  if (
    input.isTradingSuspended ||
    input.isManagement ||
    input.isInvestmentCaution ||
    input.isAbnormalSurge ||
    HARD_BLOCK_EVENT_TYPES.has(input.eventType)
  ) {
    return Infinity;
  }

  let penalty = 0;

  // 선행급등 패널티 (누적)
  const preDsclReturn = input.preDsclReturn ?? 0;
  if (preDsclReturn > 20) penalty += 40;
  if (preDsclReturn > 10) penalty += 20;

  // 정정공시 신뢰도 할인
  if (input.isAmendment) penalty += 15;

  // 계약 해제
  if (input.eventType === 'CONTRACT_CANCELLATION') penalty += 50;

  // 유상증자 고희석
  if (
    input.eventType === 'PAID_IN_CAPITAL_INCREASE' &&
    input.dilutionRate != null &&
    input.dilutionRate > 15
  ) {
    penalty += 30;
  }

  // 저유동성
  if (input.avgDailyVolume != null && input.avgDailyVolume < 100_000) {
    penalty += 20;
  }

  return clamp(penalty, 0, 100);
}
