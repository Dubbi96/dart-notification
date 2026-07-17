// backend/src/engine1-disclosure/upcoming-events/upcoming-events.controller.ts
// DAR-538: 공시발 예정 이벤트 캘린더 v1 조회 API

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpcomingEventsService, DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } from './upcoming-events.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parsePaginationInt } from '../../common/pagination/parse-pagination';

@ApiTags('upcoming-events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upcoming-events')
export class UpcomingEventsController {
  constructor(private readonly upcomingEventsService: UpcomingEventsService) {}

  /**
   * GET /upcoming-events
   * 관심기업의 공시 파생 예정 이벤트(배당 기준일·유상증자 청약일·신주 상장 예정일 등) D-day 목록.
   */
  @Get()
  @ApiOperation({
    summary: '관심기업 예정 이벤트 캘린더 (D-day)',
    description:
      '공시 이벤트 추출 수치(DisclosureEvent.extractedData)의 날짜 필드에서 파생한 ' +
      '[오늘, 오늘+days] 예정 이벤트 목록. 추출되지 않았거나 불확실한 날짜는 미표시(발명 금지). ' +
      '정정공시가 지목한 원공시 이벤트는 제외.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    example: DEFAULT_WINDOW_DAYS,
    description: `조회 윈도 일수 (기본 ${DEFAULT_WINDOW_DAYS}, 최대 ${MAX_WINDOW_DAYS})`,
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공 { baseDate, days, items: [{ kind, label, date, dDay, corpCode, corpName, stockCode, rcpNo, eventType }] }',
  })
  async findAll(@CurrentUser('id') userId: string, @Query('days') days?: string) {
    const result = await this.upcomingEventsService.findForUser(userId, {
      days: parsePaginationInt(days, {
        default: DEFAULT_WINDOW_DAYS,
        min: 1,
        max: MAX_WINDOW_DAYS,
      }),
    });
    return { success: true, data: result };
  }
}
