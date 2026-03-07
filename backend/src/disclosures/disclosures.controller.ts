import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DisclosuresService } from './disclosures.service';
import { QueryDisclosureDto, SearchDisclosureDto } from './dto/query-disclosure.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Disclosures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('disclosures')
export class DisclosuresController {
  constructor(private readonly disclosuresService: DisclosuresService) {}

  @Get()
  @ApiOperation({ summary: '공시 목록 조회' })
  async findAll(@Query() query: QueryDisclosureDto) {
    const result = await this.disclosuresService.findAll(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('search')
  @ApiOperation({ summary: '공시 검색' })
  async search(@Query() query: SearchDisclosureDto) {
    const result = await this.disclosuresService.search(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: '공시 상세 조회' })
  async findOne(@Param('id') id: string) {
    const disclosure = await this.disclosuresService.findOne(id);
    return { success: true, data: disclosure };
  }
}
