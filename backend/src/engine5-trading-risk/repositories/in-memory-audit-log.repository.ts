// Engine5 — InMemory AuditLog Repository (M11, DAR-18)
// fixture 테스트·모의운용용 인메모리 어댑터.

import {
  IAuditLogRepository,
  AuditLogRecord,
  CreateAuditLogInput,
} from './audit-log.repository';

let _seq = 0;

export class InMemoryAuditLogRepository implements IAuditLogRepository {
  private readonly logs: AuditLogRecord[] = [];

  async save(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const record: AuditLogRecord = {
      id: `audit-${++_seq}`,
      action: input.action,
      actorKind: input.actorKind,
      summary: input.summary,
      orderRequestId: input.orderRequestId ?? null,
      executionId: input.executionId ?? null,
      meta: input.meta ?? null,
      createdAt: new Date(),
    };
    this.logs.push(record);
    return record;
  }

  async findByOrderRequestId(orderRequestId: string): Promise<AuditLogRecord[]> {
    return this.logs.filter((l) => l.orderRequestId === orderRequestId);
  }

  async findAll(limit = 100): Promise<AuditLogRecord[]> {
    return this.logs.slice(-limit);
  }

  clear(): void {
    this.logs.length = 0;
    _seq = 0;
  }
}
