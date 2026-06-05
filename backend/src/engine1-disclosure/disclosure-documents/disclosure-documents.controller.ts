// backend/src/disclosure-documents/disclosure-documents.controller.ts
// 공시 원문 파싱 관리자 엔드포인트

import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { ParseStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { ParseResultDto } from './dto/parse-result.dto';
import { BatchResultDto, RetryResultDto } from './dto/batch-result.dto';
import { StatsDto } from './dto/stats.dto';

@ApiTags('document-parsing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('document-parsing')
export class DisclosureDocumentsController {
  constructor(
    private readonly disclosureDocumentsService: DisclosureDocumentsService,
  ) {}

  /**
   * 파싱 상태 현황 집계
   * 주의: GET /document-parsing/stats를 GET /document-parsing/:rcpNo보다 앞에 선언
   *       NestJS 라우팅 우선순위 충돌 방지
   */
  @Get('stats')
  @ApiOperation({ summary: '파싱 상태 현황 집계 (ParseStatus별 건수)' })
  async getStats(): Promise<StatsDto> {
    const stats = await this.disclosureDocumentsService.getStats();
    return {
      PENDING: stats[ParseStatus.PENDING] ?? 0,
      FETCHING: stats[ParseStatus.FETCHING] ?? 0,
      FETCH_FAILED: stats[ParseStatus.FETCH_FAILED] ?? 0,
      PARSING: stats[ParseStatus.PARSING] ?? 0,
      PARSE_FAILED: stats[ParseStatus.PARSE_FAILED] ?? 0,
      DONE: stats[ParseStatus.DONE] ?? 0,
      SKIPPED: stats[ParseStatus.SKIPPED] ?? 0,
    };
  }

  /**
   * 단건 공시 원문 파싱 수동 트리거
   */
  @Post('parse/:rcpNo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '단건 공시 원문 파싱 (수동 트리거)' })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호 (14자리)' })
  async parseSingle(
    @Param('rcpNo') rcpNo: string,
  ): Promise<{ rcpNo: string; parseStatus: ParseStatus; parsedAt: Date | null }> {
    const doc = await this.disclosureDocumentsService.parseDisclosure(rcpNo);
    return {
      rcpNo: doc.rcpNo,
      parseStatus: doc.parseStatus,
      parsedAt: doc.parsedAt,
    };
  }

  /**
   * PENDING 상태 배치 파싱
   */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING 상태 배치 파싱' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '처리 건수 (기본값 50, 최대 200)',
  })
  async batch(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<BatchResultDto> {
    return this.disclosureDocumentsService.processPendingBatch(limit);
  }

  /**
   * 재처리 큐 강제 실행
   */
  @Post('retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '파싱 실패 건 재처리 큐 강제 실행' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '재처리 건수 (기본값 20)',
  })
  async retry(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<RetryResultDto> {
    return this.disclosureDocumentsService.runRetryQueue(limit);
  }

  /**
   * 파싱 결과 단건 조회 (rawText 제외)
   */
  @Get(':rcpNo')
  @ApiOperation({ summary: '파싱 결과 단건 조회 (rawText 제외)' })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호' })
  async findOne(@Param('rcpNo') rcpNo: string): Promise<ParseResultDto> {
    const doc = await this.disclosureDocumentsService.findOne(rcpNo);
    return doc as unknown as ParseResultDto;
  }
}
