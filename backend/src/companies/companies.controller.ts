import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

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
