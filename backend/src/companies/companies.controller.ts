import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';

@ApiTags('Companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

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
}
