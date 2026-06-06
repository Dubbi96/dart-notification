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
import { ParseStatus, DartFiledFact } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { DartFiledFactService } from './facts/dart-filed-fact.service';
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
    private readonly dartFiledFactService: DartFiledFactService,
  ) {}

  // ─── DAR-95: 공시 본문 정량표 fact 적재/조회 ──────────────────────────────
  // 주의: 'facts/...' 경로를 ':rcpNo' 동적 라우트보다 앞에 선언(라우팅 충돌 방지)

  /**
   * 파싱 완료 문서 일괄 fact backfill (수동 트리거)
   */
  @Post('facts/backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DartFiledFact 일괄 backfill (DONE 문서 소급 적재)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '처리 문서 수 (기본값 100, 최대 1000)',
  })
  async backfillFacts(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<{ processed: number; facts: number }> {
    return this.dartFiledFactService.backfill(limit);
  }

  /**
   * 단건 공시 정량 fact 적재 (수동 트리거 / 재처리)
   */
  @Post('facts/:rcpNo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '단건 공시 정량 fact 적재 (parsedJson → DartFiledFact)' })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호 (14자리)' })
  async persistFacts(
    @Param('rcpNo') rcpNo: string,
  ): Promise<{ rcpNo: string; facts: number }> {
    const facts = await this.dartFiledFactService.persistForRcpNo(rcpNo);
    return { rcpNo, facts };
  }

  /**
   * 단건 공시 적재 fact 조회
   */
  @Get('facts/:rcpNo')
  @ApiOperation({ summary: '단건 공시 적재 fact 조회 (factKey 정렬)' })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호' })
  async getFacts(@Param('rcpNo') rcpNo: string): Promise<DartFiledFact[]> {
    return this.dartFiledFactService.findByRcpNo(rcpNo);
  }

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
