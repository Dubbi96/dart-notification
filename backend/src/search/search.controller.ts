import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { UnifiedSearchDto } from './dto/unified-search.dto';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: '통합 검색 (기업+공시 카테고리 묶음)' })
  @ApiQuery({ name: 'q', required: true, description: '통합 검색어 (2글자 이상)' })
  @ApiQuery({ name: 'companyLimit', required: false })
  @ApiQuery({ name: 'disclosureLimit', required: false })
  async search(@Query() query: UnifiedSearchDto) {
    const data = await this.searchService.search(query);
    return { success: true, data };
  }
}
