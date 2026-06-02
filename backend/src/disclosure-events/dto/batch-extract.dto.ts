// backend/src/disclosure-events/dto/batch-extract.dto.ts

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchExtractDto {
  @ApiPropertyOptional({
    description: '일괄 처리 최대 건수 (기본: 100, 최대: 500)',
    default: 100,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  limit?: number;
}

export class BatchExtractResultDto {
  @ApiPropertyOptional({ description: '성공 건수' })
  success: number;

  @ApiPropertyOptional({ description: '실패 건수' })
  failed: number;

  @ApiPropertyOptional({ description: '검토 필요 건수' })
  needsReview: number;

  @ApiPropertyOptional({ description: '처리 소요 시간 (ms)' })
  durationMs: number;
}
