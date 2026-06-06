import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { FinancialCollectionService } from './financial-collection.service';
import { FinancialQueryService } from './financial-query.service';
import { DartReportCode, DartFsDiv } from '../dart-api/dart-api.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';

// 인증(DAR-96): 쓰기(collect/backfill)는 JwtAuthGuard 로 보호, 읽기 전용 GET /latest 는
// DAR-54 패턴을 따라 OptionalJwtAuthGuard 로 게스트 열람 허용(종목 상세 펀더멘털 카드 정합).
@ApiTags('Financials')
@ApiBearerAuth()
@Controller('financials')
export class FinancialsController {
  constructor(
    private readonly collection: FinancialCollectionService,
    private readonly query: FinancialQueryService,
  ) {}

  @Post('collect')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '재무지표 수동 수집 (DART 재무제표 → CompanyFinancial, 멱등)',
  })
  @ApiQuery({ name: 'bsnsYear', required: true, description: '사업연도 (예: 2025)' })
  @ApiQuery({
    name: 'reprtCode',
    required: false,
    description: '보고서코드 11011(연간)/11012(반기)/11013(1Q)/11014(3Q)',
  })
  @ApiQuery({ name: 'fsDiv', required: false, description: 'CFS(연결,기본) | OFS(별도)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '자동 선별 상한. 미지정 시 무제한(캡 해제, DAR-55)',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    description: "자동 선별 범위 PRIORITY(기본) | ALL(전종목 우선순위 큐)",
  })
  async collect(
    @Query('bsnsYear') bsnsYear: string,
    @Query('reprtCode') reprtCode?: string,
    @Query('fsDiv') fsDiv?: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: string,
  ) {
    const result = await this.collection.collectBatch({
      bsnsYear,
      reprtCode: reprtCode as DartReportCode | undefined,
      fsDiv: fsDiv as DartFsDiv | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      scope: scope === 'ALL' ? 'ALL' : 'PRIORITY',
      triggeredBy: 'MANUAL',
    });
    return { success: true, data: result };
  }

  @Post('backfill')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '재무지표 분기 시계열 백필 (reprtCode 11011~11014 × 연도, 멱등)',
  })
  @ApiQuery({
    name: 'bsnsYears',
    required: true,
    description: '백필 사업연도 CSV (예: 2024,2023)',
  })
  @ApiQuery({ name: 'fsDiv', required: false, description: 'CFS(기본) | OFS' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '자동 선별 상한. 미지정 시 무제한(캡 해제)',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    description: 'PRIORITY(기본) | ALL(전종목)',
  })
  async backfill(
    @Query('bsnsYears') bsnsYears: string,
    @Query('fsDiv') fsDiv?: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: string,
  ) {
    const years = (bsnsYears ?? '')
      .split(',')
      .map((y) => y.trim())
      .filter(Boolean);
    const result = await this.collection.backfillTimeSeries({
      bsnsYears: years,
      fsDiv: fsDiv as DartFsDiv | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      scope: scope === 'ALL' ? 'ALL' : 'PRIORITY',
      triggeredBy: 'MANUAL',
    });
    return { success: true, data: result };
  }

  @Get('latest')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '기업 최신 재무지표 조회 (읽기 전용·게스트 열람 가능, DAR-96)',
  })
  @ApiQuery({ name: 'corpCode', required: true, description: 'DART 고유번호 8자리' })
  @ApiQuery({ name: 'fsDiv', required: false, description: 'CFS(기본) | OFS' })
  async latest(@Query('corpCode') corpCode: string, @Query('fsDiv') fsDiv?: string) {
    const data = await this.query.getLatest(corpCode, fsDiv || 'CFS');
    return { success: true, data };
  }
}
