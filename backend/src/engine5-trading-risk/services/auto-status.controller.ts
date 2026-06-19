/**
 * AutoTradingStatusController — GET /api/trading/auto-status (DAR-361)
 *
 * 자동매매 실행상태 read-only 투명성 표면: 킬스위치 상태 + 리스크게이트 차단여부 + 최근 주문.
 * 가드: OptionalJwtAuthGuard — 단일 시스템 모의 포트폴리오라 사용자별 분기 없음
 *   (graduation/metrics 와 동일 정책, 게스트 데모 조회 허용).
 *
 * ★범위 정직: 조회 전용. 주문 발주/승인/취소 같은 실행 액션 없음(executionEnabled 항상 false).
 * 금지영역 미접촉: Risk/주문/AI 판정·쓰기 0.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { parsePaginationInt } from '../../common/pagination/parse-pagination';
import {
  AutoTradingStatusService,
  AutoTradingStatusResult,
  DEFAULT_RECENT_ORDER_LIMIT,
  MAX_RECENT_ORDER_LIMIT,
} from './auto-status.service';

@ApiTags('Trading Auto Status')
@Controller('trading/auto-status')
export class AutoTradingStatusController {
  constructor(
    private readonly autoStatusService: AutoTradingStatusService,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '자동매매 실행상태 조회(읽기전용 투명성)',
    description:
      '킬스위치 상태(발동/대기·사유)·리스크게이트 차단여부·최근 주문(상태·사유·시각)을 ' +
      'read-only 로 노출. M11 미가동(executionEnabled=false) — 상태 모니터링 전용, 실행 액션 없음.',
  })
  @ApiQuery({
    name: 'recentLimit',
    required: false,
    type: Number,
    example: DEFAULT_RECENT_ORDER_LIMIT,
    description: `최근 주문 건수(기본 ${DEFAULT_RECENT_ORDER_LIMIT}, 상한 ${MAX_RECENT_ORDER_LIMIT}).`,
  })
  @ApiResponse({
    status: 200,
    description:
      '조회 성공 { success, data: { killSwitch, riskGate, recentOrders, executionEnabled, notice, asOf } }',
  })
  async getStatus(
    @Query('recentLimit') recentLimit?: string,
  ): Promise<{ success: true; data: AutoTradingStatusResult }> {
    const limit = parsePaginationInt(recentLimit, {
      default: DEFAULT_RECENT_ORDER_LIMIT,
      min: 1,
      max: MAX_RECENT_ORDER_LIMIT,
    });
    const data = await this.autoStatusService.getStatus(limit);
    return { success: true, data };
  }
}
