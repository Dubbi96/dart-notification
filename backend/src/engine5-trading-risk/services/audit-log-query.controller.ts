/**
 * AuditLogQueryController — GET /api/trading/audit-logs (DAR-351)
 *
 * 운영자(JWT 인증)가 TradingAuditLog 를 사후 검증할 수 있는 read-only 조회 엔드포인트.
 * 기간(from/to)·actorKind·action·orderRequestId 필터 + 페이지네이션을 지원한다.
 * 페이지네이션 정수는 정본 parsePaginationInt 로 정규화(비숫자/음수/거대값 안전 보정).
 *
 * 금지영역 미접촉: 조회 전용. 주문/Risk 판정·쓰기 없음.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { parsePaginationInt } from '../../common/pagination/parse-pagination';
import {
  AuditLogQueryService,
  AuditLogQueryResult,
} from './audit-log-query.service';

const MAX_AUDIT_PAGE_SIZE = 200;

@ApiTags('Trading Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trading/audit-logs')
export class AuditLogQueryController {
  constructor(private readonly auditLogQueryService: AuditLogQueryService) {}

  @Get()
  @ApiOperation({
    summary: '거래 감사로그 조회',
    description:
      '운영자용 read-only 조회. 기간·actorKind·action·orderRequestId 필터 + 페이지네이션. 최신순 정렬.',
  })
  @ApiQuery({ name: 'from', required: false, description: '기간 시작(ISO 8601, createdAt ≥)' })
  @ApiQuery({ name: 'to', required: false, description: '기간 끝(ISO 8601, createdAt ≤)' })
  @ApiQuery({ name: 'actorKind', required: false, description: '행위 주체(SYSTEM·RISK_ENGINE·USER 등)' })
  @ApiQuery({ name: 'action', required: false, enum: AuditAction, description: '감사 액션' })
  @ApiQuery({ name: 'orderRequestId', required: false, description: '연결된 주문 요청 ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiResponse({ status: 200, description: '조회 성공 { success, data: { items, total, page, limit, totalPages } }' })
  async findMany(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actorKind') actorKind?: string,
    @Query('action') action?: string,
    @Query('orderRequestId') orderRequestId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: true; data: AuditLogQueryResult }> {
    const data = await this.auditLogQueryService.findMany({
      from,
      to,
      actorKind,
      action,
      orderRequestId,
      // DAR-273 정본: 비숫자/음수 → 기본값/하한, 거대값 → 상한(무한 쿼리 차단).
      page: parsePaginationInt(page, { default: 1, min: 1 }),
      limit: parsePaginationInt(limit, {
        default: 50,
        min: 1,
        max: MAX_AUDIT_PAGE_SIZE,
      }),
    });
    return { success: true, data };
  }
}
