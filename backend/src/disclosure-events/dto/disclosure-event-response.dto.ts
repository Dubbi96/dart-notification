// backend/src/disclosure-events/dto/disclosure-event-response.dto.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventType, ExtractionStatus } from '@prisma/client';

export class DisclosureEventResponseDto {
  @ApiProperty({ description: '이벤트 ID (cuid)' })
  id: string;

  @ApiProperty({ description: 'DART 접수번호' })
  rcpNo: string;

  @ApiProperty({ description: '기업 고유번호 (DART corpCode)' })
  corpCode: string;

  @ApiProperty({ enum: EventType, description: '이벤트 타입' })
  eventType: EventType;

  @ApiProperty({ description: '이벤트별 핵심 수치 JSON' })
  extractedData: Record<string, unknown>;

  @ApiProperty({ description: '이벤트 극성', example: 'POSITIVE' })
  polarity: string;

  @ApiProperty({ description: '추출 신뢰도 (0.0~1.0)', example: 0.9 })
  confidence: number;

  @ApiProperty({ description: 'AI 보조 여부' })
  isAiAssisted: boolean;

  @ApiProperty({ enum: ExtractionStatus, description: '추출 상태' })
  extractionStatus: ExtractionStatus;

  @ApiPropertyOptional({ description: '실패 사유' })
  failReason?: string | null;

  @ApiProperty({ description: '정정공시 여부' })
  isAmendment: boolean;

  @ApiPropertyOptional({ description: '정정 대상 원공시 접수번호' })
  originalRcpNo?: string | null;

  @ApiProperty({ description: '추출 일시' })
  extractedAt: Date;

  @ApiProperty({ description: '마지막 업데이트 일시' })
  updatedAt: Date;
}
