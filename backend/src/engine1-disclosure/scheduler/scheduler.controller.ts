import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CollectRangeDto } from './dto/collect-range.dto';
import {
  ContinuousBackfillDrainService,
  ContinuousBackfillCoverage,
  ContinuousBackfillResult,
} from './continuous-backfill-drain.service';

/** 연속 백필 수동 드레인 1회 청크 수 — 쿼리 미지정 시 기본/상한. */
const BACKFILL_DEFAULT_CHUNKS = 6;
const BACKFILL_MAX_CHUNKS = 24;

@ApiTags('Scheduler')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('scheduler')
export class SchedulerController {
  constructor(
    private readonly schedulerService: SchedulerService,
    // DAR-396: 과거 공시 메타데이터 연속 확장 백필 — 수동 드레인·커버리지 리포트.
    private readonly continuousBackfill: ContinuousBackfillDrainService,
  ) {}

  @Post('collect')
  @ApiOperation({ summary: '공시 수동 수집 (날짜 지정)' })
  @ApiQuery({ name: 'bgnDe', required: true, description: 'YYYYMMDD' })
  @ApiQuery({ name: 'endDe', required: true, description: 'YYYYMMDD' })
  async collect(@Query() query: CollectRangeDto) {
    const result = await this.schedulerService.collectByDate(
      query.bgnDe,
      query.endDe,
      'MANUAL',
    );
    return { success: true, data: result };
  }

  @Get('collection-logs')
  @ApiOperation({ summary: '공시 수집 이력 조회 (최근 50건)' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'],
    description: '상태 필터 (미지정 시 전체)',
  })
  async getCollectionLogs(@Query('status') status?: string) {
    return this.schedulerService.getCollectionLogs(status);
  }

  // ─── DAR-396: 과거 공시 메타데이터 연속 확장 백필 ─────────────────────────────

  @Get('backfill-coverage')
  @ApiOperation({
    summary:
      '연속 과거 확장 백필 커버리지(read-only): 최소·최대 rcpDt·총건수·프런티어·하한 도달 여부. 과거 확장 진척 검증용.',
  })
  async backfillCoverage(): Promise<{ success: true; data: ContinuousBackfillCoverage }> {
    const data = await this.continuousBackfill.getCoverageReport();
    return { success: true, data };
  }

  @Post('backfill-extend')
  @ApiOperation({
    summary:
      '연속 과거 확장 백필 1회 실행(멱등·쿼터 인지): 프런티어 직전부터 월 단위로 과거 수집. cron과 동일 경로. 알림 미발송.',
  })
  @ApiQuery({ name: 'maxChunks', required: false, type: Number, example: 6 })
  async backfillExtend(
    @Query('maxChunks') maxChunks?: string,
  ): Promise<{ success: true; data: ContinuousBackfillResult }> {
    const parsed = maxChunks !== undefined ? Number.parseInt(maxChunks, 10) : NaN;
    const chunks = Number.isFinite(parsed)
      ? Math.max(1, Math.min(BACKFILL_MAX_CHUNKS, parsed))
      : BACKFILL_DEFAULT_CHUNKS;
    const data = await this.continuousBackfill.drainOnce({ maxChunks: chunks });
    return { success: true, data };
  }
}
