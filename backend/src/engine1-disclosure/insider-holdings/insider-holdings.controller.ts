import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InsiderHoldingsService } from './insider-holdings.service';
import { QueryInsiderHoldingsDto } from './dto/query-insider-holdings.dto';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';

/**
 * 내부자/대량보유 지분변동 조회 컨트롤러 (DAR-88).
 * DAR-87 이 매일 적재하던 InsiderHoldingChange 를 종단 노출(read-only).
 * 게스트 열람 가능(OptionalJwt) — 기존 disclosures 조회와 동일 패턴.
 */
@ApiTags('InsiderHoldings')
@Controller('insider-holdings')
export class InsiderHoldingsController {
  constructor(private readonly insiderHoldings: InsiderHoldingsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '내부자/대량보유 지분변동 조회 (corpCode·기간·방향·출처 필터)',
  })
  async findAll(@Query() query: QueryInsiderHoldingsDto) {
    const result = await this.insiderHoldings.findChanges({
      corpCode: query.corpCode,
      tradeType: query.tradeType,
      source: query.source,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });
    return { success: true, data: result.items, meta: result.meta };
  }
}
