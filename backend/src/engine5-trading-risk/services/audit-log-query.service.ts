/**
 * AuditLogQueryService — TradingAuditLog 운영자 가시성 조회 (DAR-351)
 *
 * 배경(신뢰성·책임추적): OrderRiskService(order-risk.service.ts:76-103)는 모든
 * Risk 판정(승인/거부/veto)·Kill Switch 조작을 TradingAuditLog 에 빠짐없이 기록하나,
 * 조회 API 가 없어 운영자가 사후 검증(audit review)을 할 수 없었다. 이 서비스는
 * 그 기록을 **read-only** 로 조회한다(기간·actorKind·action·orderRequestId 필터 +
 * 페이지네이션). 쓰기/판정 로직은 일절 없다 → Engine5 금지영역(Risk·주문) 미접촉.
 *
 * AI 금지영역: 조회만 수행하며 Risk/주문/AI 로직 0. 순수 read.
 * 스키마 변경 없음 — 기존 TradingAuditLog 모델(`trading_audit_logs`)을 그대로 읽는다.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** 조회 필터(컨트롤러가 페이지네이션 정수는 parsePaginationInt 로 정규화해 전달). */
export interface AuditLogQuery {
  /** 기간 시작(ISO 8601, createdAt ≥). 미지정 시 무제한. */
  from?: string;
  /** 기간 끝(ISO 8601, createdAt ≤). 미지정 시 무제한. */
  to?: string;
  /** 행위 주체(SYSTEM | RISK_ENGINE | KILL_SWITCH | USER 등) 정확 일치. */
  actorKind?: string;
  /** 감사 액션(AuditAction enum). 유효하지 않으면 400. */
  action?: string;
  /** 연결된 주문 요청 ID 정확 일치. */
  orderRequestId?: string;
  /** 1-기반 페이지(정규화된 정수, ≥1). */
  page: number;
  /** 페이지 크기(정규화된 정수, 1..MAX). */
  limit: number;
}

export interface AuditLogQueryItem {
  id: string;
  action: AuditAction;
  actorKind: string;
  summary: string;
  orderRequestId: string | null;
  executionId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogQueryResult {
  items: AuditLogQueryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const VALID_ACTIONS = new Set<string>(Object.values(AuditAction));

@Injectable()
export class AuditLogQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 감사로그 조회. 운영자 리뷰용으로 최신순(createdAt desc) 정렬.
   * 잘못된 필터(미지원 action / 파싱 불가 날짜)는 400 으로 명확히 거부한다
   * (조용히 무시하면 운영자가 빈 결과를 "사건 없음"으로 오인할 수 있음).
   */
  async findMany(query: AuditLogQuery): Promise<AuditLogQueryResult> {
    const where = this.buildWhere(query);
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.tradingAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.tradingAuditLog.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toItem(r)),
      total,
      page,
      limit,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    };
  }

  // ─── 필터 → Prisma where 매핑 ────────────────────────────────────────
  private buildWhere(query: AuditLogQuery): Prisma.TradingAuditLogWhereInput {
    const where: Prisma.TradingAuditLogWhereInput = {};

    if (query.action !== undefined) {
      if (!VALID_ACTIONS.has(query.action)) {
        throw new BadRequestException(
          `지원하지 않는 action: '${query.action}'. 허용 값: ${[...VALID_ACTIONS].join(', ')}`,
        );
      }
      where.action = query.action as AuditAction;
    }

    if (query.actorKind !== undefined) {
      where.actorKind = query.actorKind;
    }

    if (query.orderRequestId !== undefined) {
      where.orderRequestId = query.orderRequestId;
    }

    const createdAt = this.buildDateRange(query.from, query.to);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    return where;
  }

  private buildDateRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    const range: Prisma.DateTimeFilter = {};
    if (from !== undefined) {
      range.gte = this.parseDate(from, 'from');
    }
    if (to !== undefined) {
      range.lte = this.parseDate(to, 'to');
    }
    return Object.keys(range).length > 0 ? range : undefined;
  }

  private parseDate(value: string, field: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(
        `'${field}' 날짜 파싱 실패: '${value}' (ISO 8601 형식 필요)`,
      );
    }
    return d;
  }

  private toItem(row: {
    id: string;
    action: AuditAction;
    actorKind: string;
    summary: string;
    orderRequestId: string | null;
    executionId: string | null;
    meta: Prisma.JsonValue | null;
    createdAt: Date;
  }): AuditLogQueryItem {
    return {
      id: row.id,
      action: row.action,
      actorKind: row.actorKind,
      summary: row.summary,
      orderRequestId: row.orderRequestId,
      executionId: row.executionId,
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
