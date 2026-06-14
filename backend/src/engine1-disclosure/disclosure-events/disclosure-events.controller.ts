// backend/src/disclosure-events/disclosure-events.controller.ts

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { EventType, ExtractionStatus } from '@prisma/client';
import { DisclosureEventsService } from './disclosure-events.service';
import { DisclosureEventResponseDto } from './dto/disclosure-event-response.dto';
import { BatchExtractResultDto } from './dto/batch-extract.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { parsePaginationInt } from '../../common/pagination/parse-pagination';

@ApiTags('disclosure-events')
@Controller('disclosure-events')
export class DisclosureEventsController {
  constructor(private readonly disclosureEventsService: DisclosureEventsService) {}

  /**
   * GET /disclosure-events
   * 목록 조회 (corpCode·eventType·extractionStatus 필터, 페이지네이션)
   */
  @Get()
  @ApiOperation({ summary: '이벤트 목록 조회', description: 'corpCode·eventType·status 필터 지원' })
  @ApiQuery({ name: 'corpCode', required: false, description: '기업 고유번호' })
  @ApiQuery({ name: 'eventType', required: false, enum: EventType, description: '이벤트 타입' })
  @ApiQuery({ name: 'extractionStatus', required: false, enum: ExtractionStatus })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async findMany(
    @Query('corpCode') corpCode?: string,
    @Query('eventType') eventType?: EventType,
    @Query('extractionStatus') extractionStatus?: ExtractionStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.disclosureEventsService.findMany({
      corpCode,
      eventType,
      extractionStatus,
      // DAR-273: 쿼리 정수 안전 파싱 — 비숫자/음수 → 기본값/하한, 거대값 → 상한.
      page: parsePaginationInt(page, { default: 1, min: 1 }),
      limit: parsePaginationInt(limit, { default: 20, min: 1, max: 100 }),
    });
  }

  /**
   * GET /disclosure-events/:rcpNo
   * 단건 조회
   */
  @Get(':rcpNo')
  @ApiOperation({ summary: '단건 이벤트 조회' })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호' })
  @ApiResponse({ status: 200, type: DisclosureEventResponseDto })
  @ApiResponse({ status: 404, description: '이벤트 없음' })
  async findOne(@Param('rcpNo') rcpNo: string): Promise<DisclosureEventResponseDto> {
    return this.disclosureEventsService.findOne(rcpNo) as unknown as DisclosureEventResponseDto;
  }

  /**
   * POST /disclosure-events/extract/:rcpNo
   * 단건 수동 추출 트리거 (JwtAuthGuard)
   */
  @Post('extract/:rcpNo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '단건 이벤트 추출 (수동 트리거)' })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호' })
  @ApiResponse({ status: 200, type: DisclosureEventResponseDto })
  async extract(@Param('rcpNo') rcpNo: string): Promise<DisclosureEventResponseDto> {
    return this.disclosureEventsService.processDisclosure(
      rcpNo,
    ) as unknown as DisclosureEventResponseDto;
  }

  /**
   * POST /disclosure-events/batch
   * 미처리 일괄 추출 트리거 (JwtAuthGuard)
   */
  @Post('batch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '미처리 이벤트 일괄 추출' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100 })
  @ApiResponse({ status: 200, type: BatchExtractResultDto })
  async batch(@Query('limit') limit = 100): Promise<BatchExtractResultDto> {
    return this.disclosureEventsService.processPendingDisclosures(
      Number(limit),
    ) as unknown as BatchExtractResultDto;
  }

  /**
   * POST /disclosure-events/reprocess
   * DAR-58: 신규 extractor 재추출 트리거 (보유 공시 재분류, DART 호출 0, 멱등)
   */
  @Post('reprocess')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '신규 extractor 재추출',
    description: 'OTHER·FAILED 이벤트를 신규 4종 extractor로 재분류 (멱등, DART 호출 0)',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100 })
  @ApiResponse({ status: 200, description: '재추출 결과 { scanned, reclassified, durationMs }' })
  async reprocess(
    @Query('limit') limit = 100,
  ): Promise<{ scanned: number; reclassified: number; durationMs: number }> {
    return this.disclosureEventsService.reprocessForNewExtractors(Number(limit));
  }
}
