// Engine5 — TradingAuditLog 리포지토리 인터페이스 (M11, DAR-18)
// AI 금지영역: 순수 Rule.

export type AuditActionKind =
  | 'ORDER_REQUESTED'
  | 'RISK_PASSED'
  | 'RISK_REJECTED'
  | 'KILL_SWITCH_FIRED'
  | 'ORDER_EXECUTED'
  | 'ORDER_CANCELLED'
  | 'KILL_SWITCH_SET'
  | 'KILL_SWITCH_RESET';

export interface AuditLogRecord {
  id: string;
  action: AuditActionKind;
  actorKind: string;
  summary: string;
  orderRequestId?: string | null;
  executionId?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  action: AuditActionKind;
  actorKind: string;
  summary: string;
  orderRequestId?: string | null;
  executionId?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface IAuditLogRepository {
  save(input: CreateAuditLogInput): Promise<AuditLogRecord>;
  findByOrderRequestId(orderRequestId: string): Promise<AuditLogRecord[]>;
  findAll(limit?: number): Promise<AuditLogRecord[]>;
}
