import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PipelineIntegrityService } from './pipeline-integrity.service';
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
 * ★인증 미적용 — 비밀값 미노출(카운터·집계만). 운영/내부용 — 노출 범위는
 *   게이트웨이/네트워크에서 제한 권장(/ops/metrics·/collection/freshness 와 동일 정책).
 * ★read-only(health)·멱등(drain)·AI 신규 호출 0(reprocess는 기존 큐 재발행, consumer 멱등 캐시).
 */
@ApiTags('Pipeline')
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineIntegrityService) {}

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
    const data = await this.pipeline.drainOnce(clampLimit(limit));
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
    const data = await this.pipeline.reprocessMissingAi(clampLimit(limit));
    return { success: true, data };
  }
}

function clampLimit(raw?: string): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
