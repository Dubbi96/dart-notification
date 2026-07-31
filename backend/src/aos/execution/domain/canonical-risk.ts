import { RiskPolicyLimits } from '../../risk-policy/domain/risk-policy-version.types';

export interface CanonicalRiskInput {
  readonly side: 'BUY' | 'SELL';
  readonly accountType: 'LONG_TERM' | 'SYSTEM_TRADING';
  readonly accountStatus: 'ACTIVE' | 'LOCKED' | 'CLOSED';
  readonly signalBlocked: boolean;
  readonly killSwitchActive: boolean;
  readonly killSwitchMode: 'REDUCE_ONLY' | 'FULL_HALT';
  readonly requestedQuantity: number;
  readonly referencePrice: number;
  readonly totalCapital: number;
  readonly availableCash: number;
  readonly currentPositionValue: number;
  readonly sectorExposureValue: number;
  readonly dailyPnl: number;
  readonly weeklyPnl: number;
  readonly monthlyPnl: number;
  readonly drawdownPct: number;
  readonly openOrders: number;
  readonly dailyTrades: number;
  readonly openPositions: number;
}

export interface CanonicalRiskResult {
  readonly action: 'ALLOW' | 'REDUCE' | 'BLOCK';
  readonly approvedQuantity: number;
  readonly violations: readonly string[];
}

/** Kill Switch > Hard Risk > sizing 순서를 강제하는 순수 함수다. */
export function evaluateCanonicalRisk(
  input: CanonicalRiskInput,
  limits: RiskPolicyLimits,
): CanonicalRiskResult {
  const violations: string[] = [];
  if (input.accountType !== 'SYSTEM_TRADING') violations.push('ACCOUNT_NOT_SYSTEM_TRADING');
  if (input.accountStatus !== 'ACTIVE') violations.push('ACCOUNT_NOT_ACTIVE');
  if (input.signalBlocked) violations.push('SIGNAL_DECISION_BLOCKED');
  if (input.killSwitchActive) {
    if (input.killSwitchMode === 'FULL_HALT' || input.side === 'BUY') {
      violations.push('KILL_SWITCH_ACTIVE');
    }
  }
  if (input.side === 'BUY') {
    if (input.dailyPnl / input.totalCapital <= limits.dailyLossMaxPct) {
      violations.push('DAILY_LOSS_LIMIT');
    }
    if (input.weeklyPnl / input.totalCapital <= limits.weeklyLossMaxPct) {
      violations.push('WEEKLY_LOSS_LIMIT');
    }
    if (input.monthlyPnl / input.totalCapital <= limits.monthlyLossMaxPct) {
      violations.push('MONTHLY_LOSS_LIMIT');
    }
    if (input.drawdownPct <= limits.maxDrawdownPct) violations.push('MAX_DRAWDOWN');
    if (input.openOrders >= limits.maxOpenOrders) violations.push('MAX_OPEN_ORDERS');
    if (input.dailyTrades >= limits.maxDailyTrades) violations.push('MAX_DAILY_TRADES');
    if (input.openPositions >= limits.maxOpenPositions) violations.push('MAX_OPEN_POSITIONS');
  }
  if (violations.length > 0 || input.totalCapital <= 0 || input.referencePrice <= 0) {
    return Object.freeze({
      action: 'BLOCK',
      approvedQuantity: 0,
      violations: Object.freeze(
        input.totalCapital <= 0 || input.referencePrice <= 0
          ? [...violations, 'INVALID_CAPITAL_OR_PRICE']
          : violations,
      ),
    });
  }
  if (input.side === 'SELL') {
    return Object.freeze({
      action: 'ALLOW',
      approvedQuantity: input.requestedQuantity,
      violations: Object.freeze([]),
    });
  }

  const reserveCash = input.totalCapital * limits.minCashReservePct;
  const maxOrderValue = Math.min(
    input.totalCapital * limits.singleBuyMaxPct,
    input.totalCapital * limits.singlePositionMaxPct - input.currentPositionValue,
    input.totalCapital * limits.maxSectorPct - input.sectorExposureValue,
    input.availableCash - reserveCash,
  );
  const approvedQuantity = Math.max(
    0,
    Math.min(input.requestedQuantity, Math.floor(maxOrderValue / input.referencePrice)),
  );
  if (approvedQuantity <= 0) {
    return Object.freeze({
      action: 'BLOCK',
      approvedQuantity: 0,
      violations: Object.freeze(['NO_RISK_CAPACITY']),
    });
  }
  if (approvedQuantity < input.requestedQuantity) {
    return Object.freeze({
      action: 'REDUCE',
      approvedQuantity,
      violations: Object.freeze(['QUANTITY_REDUCED_TO_RISK_CAPACITY']),
    });
  }
  return Object.freeze({ action: 'ALLOW', approvedQuantity, violations: Object.freeze([]) });
}
