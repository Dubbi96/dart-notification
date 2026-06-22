import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DisclosuresService } from './disclosures.service';
import { QueryDisclosureDto, SearchDisclosureDto } from './dto/query-disclosure.dto';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DISCLOSURE_TYPES } from './constants/disclosure-types.constant';

@ApiTags('Disclosures')
@Controller('disclosures')
export class DisclosuresController {
  constructor(private readonly disclosuresService: DisclosuresService) {}

  @Get('types')
  @ApiOperation({ summary: '공시 유형 목록 조회' })
  getDisclosureTypes() {
    return { success: true, data: DISCLOSURE_TYPES };
  }

  @Get('today-count')
  @ApiOperation({
    summary: "'오늘의 공시' 수 조회 (최신 가용일 기준)",
    description:
      "'오늘' = 최신 가용 공시일(max rcpDt의 날짜)의 공시 건수. 게스트 조회 가능. date는 라벨용 YYYYMMDD(데이터 없으면 null).",
  })
  async getTodayCount() {
    const data = await this.disclosuresService.getTodayCount();
    return { success: true, data };
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '공시 목록 조회' })
  async findAll(
    @Query() query: QueryDisclosureDto,
    @CurrentUser('id') userId?: string,
  ) {
    const result = await this.disclosuresService.findAll(query, userId);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('search')
  @ApiOperation({ summary: '공시 검색' })
  async search(@Query() query: SearchDisclosureDto) {
    const result = await this.disclosuresService.search(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':rcpNo/analysis')
  @ApiOperation({ summary: '공시 AI 분석 결과 조회 (요약·polarity·Persona 해석)' })
  async findAnalysis(@Param('rcpNo') rcpNo: string) {
    const data = await this.disclosuresService.findAnalysis(rcpNo);
    return { success: true, data };
  }

  @Get(':rcpNo')
  @ApiOperation({ summary: '공시 상세 조회' })
  async findOne(@Param('rcpNo') rcpNo: string) {
    const disclosure = await this.disclosuresService.findOne(rcpNo);
    return { success: true, data: disclosure };
  }
}
