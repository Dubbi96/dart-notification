export const STRATEGY_VERSION_STATUSES = [
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

export type StrategyVersionStatus = (typeof STRATEGY_VERSION_STATUSES)[number];

export interface StrategyVersionLifecycle {
  readonly status: StrategyVersionStatus;
  readonly validatedAt?: Date | null;
  readonly approvedAt?: Date | null;
  readonly effectiveFrom?: Date | null;
  readonly retiredAt?: Date | null;
}

export interface StrategyVersionTransition {
  readonly current: StrategyVersionLifecycle;
  readonly target: StrategyVersionStatus;
  readonly now?: Date;
  readonly effectiveFrom?: Date;
}

export type StrategyVersionErrorCode =
  | 'STRATEGY_VERSION_NOT_MUTABLE'
  | 'INVALID_STRATEGY_VERSION_TRANSITION'
  | 'EFFECTIVE_FROM_REQUIRED'
  | 'EFFECTIVE_FROM_NOT_FUTURE'
  | 'ACTIVATION_TOO_EARLY'
  | 'INVALID_STRATEGY_CONFIG';

export class StrategyVersionDomainError extends Error {
  constructor(
    readonly code: StrategyVersionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StrategyVersionDomainError';
  }
}
