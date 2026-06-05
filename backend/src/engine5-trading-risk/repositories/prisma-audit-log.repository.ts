/**
 * PrismaAuditLogRepository — 거래 감사로그 영속화 어댑터 (M11, DAR-36)
 *
 * IAuditLogRepository를 Prisma(`trading_audit_logs` 테이블, 모델명 TradingAuditLog)로
 * 구현한다. M11에서 인메모리 어댑터로 시작 → DAR-36에서 Prisma로 교체(인메모리는 유지).
 *
 * AI 금지영역: 감사로그는 Risk 엔진(순수 Rule)의 결정 기록만 저장. AI 개입 0,
 * engine2/AI import 없음(risk-guard 통과). meta는 JSON 그대로 보존.
 *
 * 스키마 변경 없음 — schema.prisma의 TradingAuditLog 모델 그대로 사용.
 *   · AuditActionKind(도메인) 8종 ↔ AuditAction(Prisma enum) 8종 1:1.
 *   · id/createdAt은 DB 기본값(cuid/now)에 위임.
 *   · orderRequestId/executionId는 FK(nullable) — Kill Switch 수동 조작 등 주문 없이도 기록.
 */

import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IAuditLogRepository,
  AuditLogRecord,
  AuditActionKind,
  CreateAuditLogInput,
} from './audit-log.repository';

// Prisma row 형태 — meta는 JsonValue로 반환
type TradingAuditLogRow = {
  id: string;
  action: AuditAction;
  actorKind: string;
  summary: string;
  orderRequestId: string | null;
  executionId: string | null;
  meta: Prisma.JsonValue | null;
  createdAt: Date;
};

@Injectable()
export class PrismaAuditLogRepository implements IAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 감사로그 저장. id/createdAt은 DB가 채운다(인메모리 어댑터와 동일 시맨틱).
   * meta는 InputJsonValue로 전달, null이면 미설정(Prisma JsonNull 미사용 — nullable 컬럼).
   */
  async save(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const row = await this.prisma.tradingAuditLog.create({
      data: {
        action: input.action as AuditAction,
        actorKind: input.actorKind,
        summary: input.summary,
        orderRequestId: input.orderRequestId ?? null,
        executionId: input.executionId ?? null,
        meta:
          input.meta == null
            ? Prisma.JsonNull
            : (input.meta as unknown as Prisma.InputJsonValue),
      },
    });
    return this.toDomain(row);
  }

  async findByOrderRequestId(
    orderRequestId: string,
  ): Promise<AuditLogRecord[]> {
    const rows = await this.prisma.tradingAuditLog.findMany({
      where: { orderRequestId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findAll(limit = 100): Promise<AuditLogRecord[]> {
    const rows = await this.prisma.tradingAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    // 인메모리 findAll은 시간순(오래된→최신) slice(-limit)를 반환하므로 동일 순서로 정렬
    return rows.reverse().map((r) => this.toDomain(r));
  }

  // ─── Prisma row → 도메인 레코드 매핑 ──────────────────────────────────
  private toDomain(row: TradingAuditLogRow): AuditLogRecord {
    return {
      id: row.id,
      action: row.action as AuditActionKind,
      actorKind: row.actorKind,
      summary: row.summary,
      orderRequestId: row.orderRequestId,
      executionId: row.executionId,
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
    };
  }
}
