// backend/src/disclosure-documents/dto/stats.dto.ts

import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /document-parsing/stats 응답 DTO
 * ParseStatus별 건수 집계
 */
export class StatsDto {
  @ApiProperty({ description: '미처리 건수' })
  PENDING: number;

  @ApiProperty({ description: '다운로드 진행 중 건수' })
  FETCHING: number;

  @ApiProperty({ description: '다운로드 실패 건수' })
  FETCH_FAILED: number;

  @ApiProperty({ description: '파싱 진행 중 건수' })
  PARSING: number;

  @ApiProperty({ description: '파싱 실패 건수' })
  PARSE_FAILED: number;

  @ApiProperty({ description: '파싱 완료 건수' })
  DONE: number;

  @ApiProperty({ description: 'MAX_RETRY 초과 또는 단순공시 건수' })
  SKIPPED: number;
}
