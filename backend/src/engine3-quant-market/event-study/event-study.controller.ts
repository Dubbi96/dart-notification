import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EventStudyQueryService } from './event-study-query.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('event-study')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('event-study')
export class EventStudyController {
  constructor(private readonly eventStudyQueryService: EventStudyQueryService) {}

  @Get()
  @ApiOperation({ summary: '이벤트 스터디 결과 조회' })
  @ApiQuery({ name: 'eventType', required: false, description: '이벤트 유형 필터' })
  @ApiQuery({
    name: 'marketType',
    required: false,
    description: '시장 유형 (KOSPI / KOSDAQ / ALL, 기본: ALL)',
  })
  async findResults(
    @Query('eventType') eventType?: string,
    @Query('marketType') marketType?: string,
  ) {
    const data = await this.eventStudyQueryService.findResults({ eventType, marketType });
    return { success: true, data };
  }
}
