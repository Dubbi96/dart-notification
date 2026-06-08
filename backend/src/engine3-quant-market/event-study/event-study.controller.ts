import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EventStudyQueryService } from './event-study-query.service';
import { EventStudyCalculationService } from './event-study-calculation.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

interface CalculateBody {
  fromDate?: string;
  toDate?: string;
}

@ApiTags('event-study')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('event-study')
export class EventStudyController {
  constructor(
    private readonly eventStudyQueryService: EventStudyQueryService,
    private readonly eventStudyCalculationService: EventStudyCalculationService,
  ) {}

  @Get()
  @ApiOperation({ summary: '이벤트 스터디 결과 조회' })
  @ApiQuery({ name: 'eventType', required: false, description: '이벤트 유형 필터' })
  @ApiQuery({
    name: 'marketType',
    required: false,
    description: '시장 유형 (KOSPI / KOSDAQ / ALL, 기본: ALL)',
  })
  @ApiQuery({
    name: 'includeInsufficient',
    required: false,
    description: '표본<30 미유의(INSUFFICIENT) 데이터한계 항목 포함 여부 (기본: false → READY만)',
  })
  async findResults(
    @Query('eventType') eventType?: string,
    @Query('marketType') marketType?: string,
    @Query('includeInsufficient') includeInsufficient?: string,
  ) {
    const data = await this.eventStudyQueryService.findResults({
      eventType,
      marketType,
      includeInsufficient: includeInsufficient === 'true',
    });
    return { success: true, data };
  }

  @Post('calculate')
  @ApiOperation({
    summary: 'Event Study 산출 실행 (백필+실데이터 baseline 집계 → EventStudyResult 영속)',
  })
  async calculate(@Body() body: CalculateBody = {}) {
    const summary = await this.eventStudyCalculationService.run({
      fromDate: body?.fromDate,
      toDate: body?.toDate,
    });
    return { success: true, data: summary };
  }
}
