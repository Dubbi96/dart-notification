import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { UnifiedSearchDto } from './dto/unified-search.dto';
import { UsDemandDto } from './dto/us-demand.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * 통합 검색(횡단). 게스트 검색을 막지 않기 위해 OptionalJwtAuthGuard —
 * 토큰이 있으면 userId 를 W8 수요 계측(SearchMissLog)에 함께 남기고, 없어도 통과한다.
 */
@ApiTags('Search')
@Controller('search')
@UseGuards(OptionalJwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: '통합 검색 (기업+공시 카테고리 묶음)' })
  @ApiQuery({ name: 'q', required: true, description: '통합 검색어 (2글자 이상)' })
  @ApiQuery({ name: 'companyLimit', required: false })
  @ApiQuery({ name: 'disclosureLimit', required: false })
  async search(
    @Query() query: UnifiedSearchDto,
    @CurrentUser('id') userId?: string,
  ) {
    const data = await this.searchService.search(query, userId ?? undefined);
    return { success: true, data };
  }

  @Post('us-demand')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '미국 주식 알림 수요 기록 (원탭 버튼)',
    description:
      '갭분석 W8 계측 전용 경량 엔드포인트 — SearchMissLog 에 tag=US_DEMAND_TAP 으로 적재한다. 기능 약속 아님. 게스트 호출 가능.',
  })
  async recordUsDemand(
    @Body() dto: UsDemandDto,
    @CurrentUser('id') userId?: string,
  ) {
    await this.searchService.recordUsDemandTap(dto.q, userId ?? undefined);
    return { success: true };
  }
}
