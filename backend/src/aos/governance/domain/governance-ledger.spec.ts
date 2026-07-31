import {
  canonicalizeApprovalRecord,
  canonicalizeConfigAuditEvent,
  evaluateApprovalActorSeparation,
} from './governance-ledger';
import {
  ApprovalRecordInput,
  ConfigAuditAction,
  ConfigAuditEventInput,
  GovernanceLedgerDomainError,
} from './governance-ledger.types';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

const approval: ApprovalRecordInput = {
  subjectType: 'STRATEGY_VERSION',
  subjectId: 'strategy-version-1',
  subjectHash: hashA,
  decision: 'APPROVE',
  actorUserId: 'operator-1',
  actorRoleKey: 'role-selected-later',
  reason: 'backtest evidence reviewed',
  evidenceHash: hashB,
  correlationId: 'approval-flow-1',
  idempotencyKey: 'approval-request-1',
};

const audit: ConfigAuditEventInput = {
  subjectType: 'RISK_POLICY_VERSION',
  subjectId: 'risk-policy-1',
  action: 'DRAFT_MUTATED',
  actorType: 'USER',
  actorUserId: 'operator-1',
  actorContextSnapshot: 'role-selected-later',
  reason: 'updated draft limits',
  beforeHash: hashA,
  afterHash: hashB,
  correlationId: 'config-flow-1',
  idempotencyKey: 'config-event-1',
};

describe('approval record canonicalization', () => {
  it('normalizes text and produces a stable lowercase SHA-256 record hash', () => {
    const first = canonicalizeApprovalRecord({
      ...approval,
      reason: '  backtest evidence reviewed  ',
    });
    const second = canonicalizeApprovalRecord(approval);

    expect(first).toEqual(second);
    expect(first.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the record hash when the decision or evidence changes', () => {
    expect(canonicalizeApprovalRecord(approval).recordHash).not.toBe(
      canonicalizeApprovalRecord({ ...approval, decision: 'REJECT' }).recordHash,
    );
    expect(canonicalizeApprovalRecord(approval).recordHash).not.toBe(
      canonicalizeApprovalRecord({ ...approval, evidenceHash: 'c'.repeat(64) }).recordHash,
    );
  });

  it.each([
    ['subjectId', ''],
    ['reason', '   '],
    ['subjectHash', 'A'.repeat(64)],
    ['evidenceHash', 'not-a-hash'],
    ['correlationId', ''],
    ['idempotencyKey', ''],
  ])('rejects an invalid %s', (field, value) => {
    expect(() => canonicalizeApprovalRecord({ ...approval, [field]: value })).toThrow(
      expect.objectContaining({ code: 'INVALID_APPROVAL_RECORD' }),
    );
  });

  it('rejects unknown subject types and decisions at runtime', () => {
    expect(() =>
      canonicalizeApprovalRecord({
        ...approval,
        subjectType: 'ORDER' as ApprovalRecordInput['subjectType'],
      }),
    ).toThrow(GovernanceLedgerDomainError);
    expect(() =>
      canonicalizeApprovalRecord({
        ...approval,
        decision: 'OVERRIDE' as ApprovalRecordInput['decision'],
      }),
    ).toThrow(GovernanceLedgerDomainError);
  });
});

describe('config audit event canonicalization', () => {
  it('produces the same event hash for the same normalized event', () => {
    expect(
      canonicalizeConfigAuditEvent({
        ...audit,
        reason: ` ${audit.reason} `,
      }),
    ).toEqual(canonicalizeConfigAuditEvent(audit));
  });

  it.each<[ConfigAuditAction, string | null, string | null]>([
    ['CREATED', null, hashA],
    ['DRAFT_MUTATED', hashA, hashB],
    ['DELETED', hashA, null],
    ['STATE_TRANSITIONED', hashA, hashA],
    ['ACTIVATION_RECORDED', hashA, hashA],
  ])('accepts the %s before/after hash contract', (action, beforeHash, afterHash) => {
    expect(
      canonicalizeConfigAuditEvent({
        ...audit,
        action,
        beforeHash,
        afterHash,
      }).eventHash,
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<[ConfigAuditAction, string | null, string | null]>([
    ['CREATED', hashA, hashB],
    ['DRAFT_MUTATED', null, hashB],
    ['DELETED', hashA, hashB],
    ['STATE_TRANSITIONED', hashA, null],
    ['ACTIVATION_RECORDED', null, null],
  ])('rejects the invalid %s before/after hash contract', (action, beforeHash, afterHash) => {
    expect(() =>
      canonicalizeConfigAuditEvent({
        ...audit,
        action,
        beforeHash,
        afterHash,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG_AUDIT_EVENT' }));
  });

  it('requires a user id only for USER actors', () => {
    expect(() => canonicalizeConfigAuditEvent({ ...audit, actorUserId: null })).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG_AUDIT_EVENT' }),
    );
    expect(() =>
      canonicalizeConfigAuditEvent({
        ...audit,
        actorType: 'SYSTEM',
        actorUserId: 'operator-1',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG_AUDIT_EVENT' }));
    expect(() =>
      canonicalizeConfigAuditEvent({
        ...audit,
        actorType: 'SYSTEM',
        actorUserId: null,
      }),
    ).not.toThrow();
  });

  it.each([
    ['subjectId', ''],
    ['actorContextSnapshot', '   '],
    ['reason', ''],
    ['beforeHash', 'A'.repeat(64)],
    ['correlationId', ''],
    ['idempotencyKey', ''],
  ])('rejects an invalid %s', (field, value) => {
    expect(() => canonicalizeConfigAuditEvent({ ...audit, [field]: value })).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG_AUDIT_EVENT' }),
    );
  });

  it('rejects unknown subjects, actions, and actor types at runtime', () => {
    expect(() =>
      canonicalizeConfigAuditEvent({
        ...audit,
        subjectType: 'ORDER' as ConfigAuditEventInput['subjectType'],
      }),
    ).toThrow(GovernanceLedgerDomainError);
    expect(() =>
      canonicalizeConfigAuditEvent({
        ...audit,
        action: 'OVERRIDE' as ConfigAuditEventInput['action'],
      }),
    ).toThrow(GovernanceLedgerDomainError);
    expect(() =>
      canonicalizeConfigAuditEvent({
        ...audit,
        actorType: 'AI' as ConfigAuditEventInput['actorType'],
      }),
    ).toThrow(GovernanceLedgerDomainError);
  });
});

describe('approval actor separation policy', () => {
  it('does not choose a default and follows the explicitly supplied policy', () => {
    expect(
      evaluateApprovalActorSeparation({
        requestedByUserId: 'operator-1',
        actorUserId: 'operator-1',
        policy: 'ALLOW_SAME_ACTOR',
      }),
    ).toEqual({ allowed: true, reason: 'NOT_REQUIRED' });

    expect(
      evaluateApprovalActorSeparation({
        requestedByUserId: 'operator-1',
        actorUserId: 'operator-1',
        policy: 'REQUIRE_DISTINCT_ACTOR',
      }),
    ).toEqual({ allowed: false, reason: 'SELF_APPROVAL_FORBIDDEN' });

    expect(
      evaluateApprovalActorSeparation({
        requestedByUserId: 'operator-1',
        actorUserId: 'operator-2',
        policy: 'REQUIRE_DISTINCT_ACTOR',
      }),
    ).toEqual({ allowed: true, reason: 'DISTINCT_ACTOR' });
  });

  it('rejects blank actors and unknown policy values', () => {
    expect(() =>
      evaluateApprovalActorSeparation({
        requestedByUserId: ' ',
        actorUserId: 'operator-2',
        policy: 'REQUIRE_DISTINCT_ACTOR',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_APPROVAL_ACTOR' }));
    expect(() =>
      evaluateApprovalActorSeparation({
        requestedByUserId: 'operator-1',
        actorUserId: 'operator-2',
        policy: 'UNKNOWN' as 'REQUIRE_DISTINCT_ACTOR',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_APPROVAL_ACTOR' }));
  });
});
