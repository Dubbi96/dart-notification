// backend/src/disclosure-documents/dto/parse-result.dto.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParseStatus } from '@prisma/client';
import { Table } from '../types/table.type';
import { ParsedJson } from '../types/parsed-json.type';
import { AmendmentDiff } from '../types/amendment-diff.type';

/**
 * GET /document-parsing/:rcpNo 응답 DTO
 * rawText는 의도적으로 제외 (응답 크기 제어)
 */
export class ParseResultDto {
  @ApiProperty({ description: 'DART 접수번호' })
  rcpNo: string;

  @ApiProperty({ description: '기업 고유번호' })
  corpCode: string;

  @ApiProperty({ enum: ParseStatus, description: '파싱 상태' })
  parseStatus: ParseStatus;

  @ApiPropertyOptional({ description: 'rawText 글자 수 (AI 토큰 비용 예측용)' })
  wordCount: number | null;

  @ApiProperty({ description: '정정공시 여부' })
  isAmendment: boolean;

  @ApiPropertyOptional({ description: '원공시 rcpNo (정정 시에만)' })
  originalRcpNo: string | null;

  @ApiPropertyOptional({ description: '추출된 표 목록 (Table[])' })
  tables: Table[] | null;

  @ApiPropertyOptional({ description: '핵심 key-value 구조화 결과' })
  parsedJson: ParsedJson | null;

  @ApiPropertyOptional({ description: '정정 전후 변경 필드 diff' })
  amendmentDiff: AmendmentDiff | null;

  @ApiPropertyOptional({ description: '원문 파일 저장 경로 (로컬/S3 key)' })
  rawFilePath: string | null;

  @ApiPropertyOptional({ description: '원문 다운로드 완료 시각' })
  fetchedAt: Date | null;

  @ApiPropertyOptional({ description: '파싱 완료 시각' })
  parsedAt: Date | null;

  @ApiProperty({ description: '재처리 누적 횟수' })
  retryCount: number;

  @ApiPropertyOptional({ description: '마지막 실패 오류 메시지' })
  lastError: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
