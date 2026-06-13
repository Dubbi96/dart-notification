import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { EventStudyQueryService } from '../engine3-quant-market/event-study/event-study-query.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@ApiTags('Companies')
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly eventStudyQueryService: EventStudyQueryService,
  ) {}

  @Get('popular')
  @ApiOperation({ summary: '인기 기업 목록 (온보딩용)' })
  async getPopular() {
    const companies = await this.companiesService.getPopularCompanies();
    return { success: true, data: companies };
  }

  @Get('search')
  @ApiOperation({ summary: '기업 검색 (자동완성)' })
  @ApiQuery({ name: 'query', required: true })
  @ApiQuery({ name: 'limit', required: false })
  async search(@Query('query') query: string, @Query('limit') limit?: number) {
    const companies = await this.companiesService.search(query, limit);
    return { success: true, data: companies };
  }

  @Get(':corpCode')
  @ApiOperation({ summary: '기업 상세 조회' })
  async findOne(@Param('corpCode') corpCode: string) {
    const company = await this.companiesService.findByCorpCode(corpCode);
    return { success: true, data: company };
  }

  // DAR-190: 종목 상세 "통계" 탭. 모바일이 호출하던 /companies/:corpCode/event-study 라우트 부재로
  // 전종목 404 → 추가. 시장 전체 통계라 비민감 데이터 → 게스트 열람 허용(OptionalJwt, 시세 API와 동일 패턴).
  @Get(':corpCode/event-study')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '기업별 이벤트 스터디 통계 (이 기업이 제출한 공시 유형의 시장 전체 집계)',
  })
  @ApiParam({ name: 'corpCode', description: '기업 고유번호 (8자리)' })
  @ApiQuery({ name: 'eventType', required: false, description: '이벤트 유형 필터' })
  @ApiQuery({
    name: 'marketType',
    required: false,
    description: '시장 유형 (KOSPI / KOSDAQ / ALL, 기본: ALL)',
  })
  async getEventStudy(
    @Param('corpCode') corpCode: string,
    @Query('eventType') eventType?: string,
    @Query('marketType') marketType?: string,
  ) {
    const data = await this.eventStudyQueryService.findResultsByCorpCode({
      corpCode,
      eventType,
      marketType,
    });
    return { success: true, data };
  }
}
