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

@ApiTags('Financials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('financials')
export class FinancialsController {
  constructor(
    private readonly collection: FinancialCollectionService,
    private readonly query: FinancialQueryService,
  ) {}

  @Post('collect')
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
  @ApiQuery({ name: 'limit', required: false, description: '자동 선별 상한 (기본 50)' })
  async collect(
    @Query('bsnsYear') bsnsYear: string,
    @Query('reprtCode') reprtCode?: string,
    @Query('fsDiv') fsDiv?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.collection.collectBatch({
      bsnsYear,
      reprtCode: reprtCode as DartReportCode | undefined,
      fsDiv: fsDiv as DartFsDiv | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      triggeredBy: 'MANUAL',
    });
    return { success: true, data: result };
  }

  @Get('latest')
  @ApiOperation({ summary: '기업 최신 재무지표 조회' })
  @ApiQuery({ name: 'corpCode', required: true, description: 'DART 고유번호 8자리' })
  @ApiQuery({ name: 'fsDiv', required: false, description: 'CFS(기본) | OFS' })
  async latest(@Query('corpCode') corpCode: string, @Query('fsDiv') fsDiv?: string) {
    const data = await this.query.getLatest(corpCode, fsDiv || 'CFS');
    return { success: true, data };
  }
}
