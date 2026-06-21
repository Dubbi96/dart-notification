import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { EventStudyQueryService } from './event-study-query.service';
import { EventStudyCalculationService } from './event-study-calculation.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { parsePaginationInt } from '../../common/pagination/parse-pagination';

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

  @Get(':bucketKey/observations')
  @ApiOperation({
    summary: '버킷 구성 개별 관측치 드릴다운 (표본 투명성 — 어떤 공시들로 만든 통계인가)',
  })
  @ApiParam({ name: 'bucketKey', description: '버킷 식별자 (예: SUPPLY_CONTRACT__ratio_5to20)' })
  @ApiQuery({ name: 'eventType', required: false, description: '이벤트 유형 추가 필터(선택)' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지 크기 (1~100, 기본 20)' })
  @ApiQuery({ name: 'offset', required: false, description: '오프셋 (기본 0)' })
  async findObservations(
    @Param('bucketKey') bucketKey: string,
    @Query('eventType') eventType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const data = await this.eventStudyQueryService.findObservations({
      bucketKey,
      eventType,
      // DAR-273: 쿼리 정수 안전 파싱 — 비숫자/음수 offset → 0, 거대 limit → 상한 100.
      limit: parsePaginationInt(limit, { default: 20, min: 1, max: 100 }),
      offset: parsePaginationInt(offset, { default: 0, min: 0 }),
    });
    return { success: true, data };
  }

  @Get(':bucketKey/distribution')
  @ApiOperation({
    summary: '버킷 D+N 초과수익 분포 요약 (DAR-402 — 평균 vs 중앙값 괴리로 이상치 오염 표면화)',
  })
  @ApiParam({ name: 'bucketKey', description: '버킷 식별자 (예: SUPPLY_CONTRACT__ratio_5to20)' })
  @ApiQuery({ name: 'eventType', required: false, description: '이벤트 유형 추가 필터(선택)' })
  async getDistribution(
    @Param('bucketKey') bucketKey: string,
    @Query('eventType') eventType?: string,
  ) {
    const data = await this.eventStudyQueryService.getDistribution({ bucketKey, eventType });
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
