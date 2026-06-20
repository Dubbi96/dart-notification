import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { parsePaginationInt } from '../../common/pagination/parse-pagination';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import {
  EventBackfillDrainService,
  EventBackfillDrainResult,
  EventCoverageReport,
} from './event-backfill-drain.service';
import {
  AiReprocessResult,
  PipelineDrainResult,
  PipelineHealth,
} from './pipeline.types';

/** drain/AI 재처리 1회 상한(쿼리 미지정 시 기본). */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * 파이프라인 폐루프 운영 엔드포인트 (DAR-126).
 *
 * GET  /pipeline/health      — 단계별 건수·지연·실패 행 read-only 스냅샷.
 * POST /pipeline/drain       — 누락분 backfill 1회 수동 실행(멱등). cron과 동일 경로.
 * POST /pipeline/reprocess-ai — AI summary 미도달 자격 이벤트 큐 재발행(★운영자 수동 전용).
 *
 * ★인증 필수(DAR-176) — JwtAuthGuard 컨트롤러 전역 적용. drain/reprocess-ai 변형
 *   엔드포인트가 외부 무인증 호출로 backfill 큐·AI 재발행을 유발해 DoS·AI 비용을
 *   일으키는 것을 차단한다. cron(pipeline-drain.scheduler)은 서비스 직접 호출이라
 *   컨트롤러 가드의 영향을 받지 않는다.
 * ★read-only(health)·멱등(drain)·AI 신규 호출 0(reprocess는 기존 큐 재발행, consumer 멱등 캐시).
 */
@ApiTags('Pipeline')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pipeline')
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineIntegrityService,
    // DAR-391: 과거 공시 이벤트 추출 백필 — 수동 드레인·커버리지 리포트.
    private readonly eventBackfill: EventBackfillDrainService,
  ) {}

  @Get('health')
  @ApiOperation({
    summary:
      '수집→파싱→이벤트→AI 단계별 건수·지연·실패 행 스냅샷(read-only). 운영/내부용',
  })
  async health(): Promise<{ success: true; data: PipelineHealth }> {
    const data = await this.pipeline.getHealth();
    return { success: true, data };
  }

  @Post('drain')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '폐루프 누락분 backfill 1회 실행(멱등): 누락문서 큐등록→PENDING 파싱→무이벤트 이벤트 추출. AI는 자동 체이닝.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100 })
  async drain(
    @Query('limit') limit?: string,
  ): Promise<{ success: true; data: PipelineDrainResult }> {
    const data = await this.pipeline.drainOnce(
      parsePaginationInt(limit, { default: DEFAULT_LIMIT, min: 1, max: MAX_LIMIT }),
    );
    return { success: true, data };
  }

  @Post('reprocess-ai')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'AI summary 미도달 자격 이벤트(SUCCESS|NEEDS_REVIEW) 큐 재발행(★운영자 수동 전용·멱등). 큐 미가용 시 0.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100 })
  async reprocessAi(
    @Query('limit') limit?: string,
  ): Promise<{ success: true; data: AiReprocessResult }> {
    const data = await this.pipeline.reprocessMissingAi(
      parsePaginationInt(limit, { default: DEFAULT_LIMIT, min: 1, max: MAX_LIMIT }),
    );
    return { success: true, data };
  }

  // ─── DAR-391: 과거 공시 이벤트 추출 백필 ─────────────────────────────────────

  @Get('event-coverage')
  @ApiOperation({
    summary:
      'rcpDt 월(YYYYMM)별 이벤트 추출 커버리지 분포(read-only). 백필 공시 연중화 진척 검증용.',
  })
  async eventCoverage(): Promise<{ success: true; data: EventCoverageReport }> {
    const data = await this.eventBackfill.getCoverageReport();
    return { success: true, data };
  }

  @Post('event-backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '과거 백필 공시 이벤트 추출 백필 1회 실행(멱등): DONE 문서 무이벤트 추출(Rule)→미파싱 파싱등록. cron과 동일 경로. AI 신규 호출 0.',
  })
  @ApiQuery({ name: 'extractLimit', required: false, type: Number, example: 200 })
  @ApiQuery({ name: 'parseEnqueueLimit', required: false, type: Number, example: 200 })
  async eventBackfillDrain(
    @Query('extractLimit') extractLimit?: string,
    @Query('parseEnqueueLimit') parseEnqueueLimit?: string,
  ): Promise<{ success: true; data: EventBackfillDrainResult }> {
    const data = await this.eventBackfill.drainOnce({
      extractLimit: parseOptionalInt(extractLimit),
      parseEnqueueLimit: parseOptionalInt(parseEnqueueLimit),
    });
    return { success: true, data };
  }
}

/** 쿼리 정수 옵션 파싱 — 미지정/불량은 undefined(서비스 기본값 사용). */
function parseOptionalInt(raw?: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}
