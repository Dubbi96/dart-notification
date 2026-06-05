// backend/src/disclosure-documents/dto/batch-result.dto.ts

import { ApiProperty } from '@nestjs/swagger';

/**
 * POST /document-parsing/batch 응답 DTO
 */
export class BatchResultDto {
  @ApiProperty({ description: '파싱 성공 건수' })
  success: number;

  @ApiProperty({ description: '파싱 실패 건수' })
  failed: number;

  @ApiProperty({ description: '처리 소요 시간 (ms)' })
  durationMs: number;
}

/**
 * POST /document-parsing/retry 응답 DTO
 */
export class RetryResultDto {
  @ApiProperty({ description: '재처리 실행 시작 건수' })
  queued: number;
}
