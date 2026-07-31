import { createHash } from 'crypto';

import {
  APPROVAL_DECISIONS,
  APPROVAL_SUBJECT_TYPES,
  ApprovalActorSeparationInput,
  ApprovalActorSeparationResult,
  ApprovalRecordInput,
  CanonicalApprovalRecord,
  CanonicalConfigAuditEvent,
  CONFIG_AUDIT_ACTIONS,
  CONFIG_AUDIT_SUBJECT_TYPES,
  ConfigAuditEventInput,
  GovernanceLedgerDomainError,
} from './governance-ledger.types';

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function canonicalizeApprovalRecord(input: ApprovalRecordInput): CanonicalApprovalRecord {
  const normalized = {
    subjectType: oneOf(
      input.subjectType,
      APPROVAL_SUBJECT_TYPES,
      'subjectType',
      'INVALID_APPROVAL_RECORD',
    ),
    subjectId: nonBlank(input.subjectId, 'subjectId', 'INVALID_APPROVAL_RECORD'),
    subjectHash: hash(input.subjectHash, 'subjectHash', 'INVALID_APPROVAL_RECORD'),
    decision: oneOf(input.decision, APPROVAL_DECISIONS, 'decision', 'INVALID_APPROVAL_RECORD'),
    actorUserId: nonBlank(input.actorUserId, 'actorUserId', 'INVALID_APPROVAL_RECORD'),
    actorRoleKey: nonBlank(input.actorRoleKey, 'actorRoleKey', 'INVALID_APPROVAL_RECORD'),
    reason: nonBlank(input.reason, 'reason', 'INVALID_APPROVAL_RECORD'),
    evidenceHash: hash(input.evidenceHash, 'evidenceHash', 'INVALID_APPROVAL_RECORD'),
    correlationId: nonBlank(input.correlationId, 'correlationId', 'INVALID_APPROVAL_RECORD'),
    idempotencyKey: nonBlank(input.idempotencyKey, 'idempotencyKey', 'INVALID_APPROVAL_RECORD'),
  } satisfies ApprovalRecordInput;

  return {
    ...normalized,
    recordHash: sha256(JSON.stringify(normalized)),
  };
}

export function canonicalizeConfigAuditEvent(
  input: ConfigAuditEventInput,
): CanonicalConfigAuditEvent {
  const action = oneOf(input.action, CONFIG_AUDIT_ACTIONS, 'action', 'INVALID_CONFIG_AUDIT_EVENT');
  const actorType = oneOf(
    input.actorType,
    ['USER', 'SYSTEM'] as const,
    'actorType',
    'INVALID_CONFIG_AUDIT_EVENT',
  );
  const actorUserId = optionalNonBlank(
    input.actorUserId,
    'actorUserId',
    'INVALID_CONFIG_AUDIT_EVENT',
  );

  if (
    (actorType === 'USER' && actorUserId === null) ||
    (actorType === 'SYSTEM' && actorUserId !== null)
  ) {
    throw invalidAudit('actorUserId', 'must be present only when actorType is USER');
  }

  const beforeHash = optionalHash(input.beforeHash, 'beforeHash', 'INVALID_CONFIG_AUDIT_EVENT');
  const afterHash = optionalHash(input.afterHash, 'afterHash', 'INVALID_CONFIG_AUDIT_EVENT');
  assertAuditHashShape(action, beforeHash, afterHash);

  const normalized = {
    subjectType: oneOf(
      input.subjectType,
      CONFIG_AUDIT_SUBJECT_TYPES,
      'subjectType',
      'INVALID_CONFIG_AUDIT_EVENT',
    ),
    subjectId: nonBlank(input.subjectId, 'subjectId', 'INVALID_CONFIG_AUDIT_EVENT'),
    action,
    actorType,
    actorUserId,
    actorContextSnapshot: nonBlank(
      input.actorContextSnapshot,
      'actorContextSnapshot',
      'INVALID_CONFIG_AUDIT_EVENT',
    ),
    reason: nonBlank(input.reason, 'reason', 'INVALID_CONFIG_AUDIT_EVENT'),
    beforeHash,
    afterHash,
    correlationId: nonBlank(input.correlationId, 'correlationId', 'INVALID_CONFIG_AUDIT_EVENT'),
    idempotencyKey: nonBlank(input.idempotencyKey, 'idempotencyKey', 'INVALID_CONFIG_AUDIT_EVENT'),
  } satisfies ConfigAuditEventInput;

  return {
    ...normalized,
    eventHash: sha256(JSON.stringify(normalized)),
  };
}

export function evaluateApprovalActorSeparation({
  requestedByUserId,
  actorUserId,
  policy,
}: ApprovalActorSeparationInput): ApprovalActorSeparationResult {
  const requester = nonBlank(requestedByUserId, 'requestedByUserId', 'INVALID_APPROVAL_ACTOR');
  const actor = nonBlank(actorUserId, 'actorUserId', 'INVALID_APPROVAL_ACTOR');

  if (policy === 'ALLOW_SAME_ACTOR') {
    return { allowed: true, reason: 'NOT_REQUIRED' };
  }
  if (policy !== 'REQUIRE_DISTINCT_ACTOR') {
    throw new GovernanceLedgerDomainError(
      'INVALID_APPROVAL_ACTOR',
      `Invalid approval separation policy: ${String(policy)}.`,
    );
  }
  return requester === actor
    ? { allowed: false, reason: 'SELF_APPROVAL_FORBIDDEN' }
    : { allowed: true, reason: 'DISTINCT_ACTOR' };
}

function assertAuditHashShape(
  action: ConfigAuditEventInput['action'],
  beforeHash: string | null,
  afterHash: string | null,
): void {
  const valid =
    (action === 'CREATED' && beforeHash === null && afterHash !== null) ||
    (action === 'DELETED' && beforeHash !== null && afterHash === null) ||
    (action !== 'CREATED' && action !== 'DELETED' && beforeHash !== null && afterHash !== null);
  if (!valid) {
    throw invalidAudit('beforeHash/afterHash', `${action} has an invalid before/after hash shape`);
  }
}

function nonBlank(
  value: unknown,
  field: string,
  code: 'INVALID_APPROVAL_RECORD' | 'INVALID_CONFIG_AUDIT_EVENT' | 'INVALID_APPROVAL_ACTOR',
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GovernanceLedgerDomainError(code, `${field} must be a non-blank string.`);
  }
  return value.trim();
}

function optionalNonBlank(
  value: unknown,
  field: string,
  code: 'INVALID_CONFIG_AUDIT_EVENT',
): string | null {
  if (value === null) {
    return null;
  }
  return nonBlank(value, field, code);
}

function hash(
  value: unknown,
  field: string,
  code: 'INVALID_APPROVAL_RECORD' | 'INVALID_CONFIG_AUDIT_EVENT',
): string {
  const normalized = nonBlank(value, field, code);
  if (!SHA256_HEX.test(normalized)) {
    throw new GovernanceLedgerDomainError(code, `${field} must be a lowercase SHA-256 hex.`);
  }
  return normalized;
}

function optionalHash(
  value: unknown,
  field: string,
  code: 'INVALID_CONFIG_AUDIT_EVENT',
): string | null {
  return value === null ? null : hash(value, field, code);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  code: 'INVALID_APPROVAL_RECORD' | 'INVALID_CONFIG_AUDIT_EVENT',
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new GovernanceLedgerDomainError(code, `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}

function invalidAudit(field: string, reason: string): GovernanceLedgerDomainError {
  return new GovernanceLedgerDomainError(
    'INVALID_CONFIG_AUDIT_EVENT',
    `Invalid config audit event at ${field}: ${reason}.`,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
