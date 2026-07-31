export const RISK_POLICY_VERSION_STATUSES = [
  'DRAFT',
  'VALIDATED',
  'BACKTESTED',
  'APPROVAL_PENDING',
  'APPROVED',
  'SCHEDULED',
  'ACTIVE',
  'REJECTED',
  'SUPERSEDED',
  'ROLLED_BACK',
  'RETIRED',
] as const;

export type RiskPolicyVersionStatus = (typeof RISK_POLICY_VERSION_STATUSES)[number];

export interface RiskPolicyVersionLifecycle {
  readonly status: RiskPolicyVersionStatus;
  readonly validatedAt?: Date | null;
  readonly approvedAt?: Date | null;
  readonly effectiveFrom?: Date | null;
  readonly retiredAt?: Date | null;
}

export interface RiskPolicyVersionTransition {
  readonly current: RiskPolicyVersionLifecycle;
  readonly target: RiskPolicyVersionStatus;
  readonly now?: Date;
  readonly effectiveFrom?: Date;
}

export type RiskPolicyVersionErrorCode =
  | 'RISK_POLICY_NOT_MUTABLE'
  | 'INVALID_RISK_POLICY_TRANSITION'
  | 'RISK_POLICY_EFFECTIVE_FROM_REQUIRED'
  | 'RISK_POLICY_EFFECTIVE_FROM_NOT_FUTURE'
  | 'RISK_POLICY_ACTIVATION_TOO_EARLY'
  | 'INVALID_RISK_POLICY_LIMITS'
  | 'UNSAFE_RISK_POLICY_CAPABILITY';

export class RiskPolicyVersionDomainError extends Error {
  constructor(
    readonly code: RiskPolicyVersionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RiskPolicyVersionDomainError';
  }
}

export interface RiskPolicyLimits {
  readonly schemaVersion: number;
  readonly singleBuyMaxPct: number;
  readonly singlePositionMaxPct: number;
  readonly dailyLossMaxPct: number;
  readonly weeklyLossMaxPct: number;
  readonly monthlyLossMaxPct: number;
  readonly maxDrawdownPct: number;
  readonly maxOpenOrders: number;
  readonly maxDailyTrades: number;
  readonly maxOpenPositions: number;
  readonly maxSectorPct: number;
  readonly minCashReservePct: number;
  readonly killSwitchMode: 'REDUCE_ONLY' | 'FULL_HALT';
  readonly constraints: {
    readonly assetClass: 'KR_STOCK';
    readonly direction: 'LONG_ONLY';
    readonly allowShort: false;
    readonly allowLeverage: false;
    readonly autoCoverFromLongTermAssets: false;
  };
}
