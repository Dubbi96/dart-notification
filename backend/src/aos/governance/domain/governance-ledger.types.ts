export const APPROVAL_SUBJECT_TYPES = [
  'STRATEGY_VERSION',
  'RISK_POLICY_VERSION',
  'VERSION_ACTIVATION',
] as const;

export type ApprovalSubjectType = (typeof APPROVAL_SUBJECT_TYPES)[number];

export const APPROVAL_DECISIONS = ['APPROVE', 'REJECT'] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const CONFIG_AUDIT_SUBJECT_TYPES = [
  'STRATEGY',
  'RULE_DEFINITION',
  'STRATEGY_VERSION',
  'RISK_POLICY_VERSION',
  'VERSION_ACTIVATION',
] as const;

export type ConfigAuditSubjectType = (typeof CONFIG_AUDIT_SUBJECT_TYPES)[number];

export const CONFIG_AUDIT_ACTIONS = [
  'CREATED',
  'DRAFT_MUTATED',
  'DELETED',
  'STATE_TRANSITIONED',
  'ACTIVATION_RECORDED',
] as const;

export type ConfigAuditAction = (typeof CONFIG_AUDIT_ACTIONS)[number];

export type ConfigAuditActorType = 'USER' | 'SYSTEM';

export interface ApprovalRecordInput {
  readonly subjectType: ApprovalSubjectType;
  readonly subjectId: string;
  readonly subjectHash: string;
  readonly decision: ApprovalDecision;
  readonly actorUserId: string;
  readonly actorRoleKey: string;
  readonly reason: string;
  readonly evidenceHash: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface CanonicalApprovalRecord extends ApprovalRecordInput {
  readonly recordHash: string;
}

export interface ConfigAuditEventInput {
  readonly subjectType: ConfigAuditSubjectType;
  readonly subjectId: string;
  readonly action: ConfigAuditAction;
  readonly actorType: ConfigAuditActorType;
  readonly actorUserId: string | null;
  readonly actorContextSnapshot: string;
  readonly reason: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface CanonicalConfigAuditEvent extends ConfigAuditEventInput {
  readonly eventHash: string;
}

export type ApprovalSeparationPolicy = 'ALLOW_SAME_ACTOR' | 'REQUIRE_DISTINCT_ACTOR';

export interface ApprovalActorSeparationInput {
  readonly requestedByUserId: string;
  readonly actorUserId: string;
  readonly policy: ApprovalSeparationPolicy;
}

export interface ApprovalActorSeparationResult {
  readonly allowed: boolean;
  readonly reason: 'NOT_REQUIRED' | 'DISTINCT_ACTOR' | 'SELF_APPROVAL_FORBIDDEN';
}

export type GovernanceLedgerErrorCode =
  'INVALID_APPROVAL_RECORD' | 'INVALID_CONFIG_AUDIT_EVENT' | 'INVALID_APPROVAL_ACTOR';

export class GovernanceLedgerDomainError extends Error {
  constructor(
    readonly code: GovernanceLedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GovernanceLedgerDomainError';
  }
}
