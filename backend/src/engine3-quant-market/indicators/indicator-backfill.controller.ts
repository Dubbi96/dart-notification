/**
 * 기술지표 백필 수동 트리거 컨트롤러 (DAR-50).
 * POST /indicators/backfill — DB 일봉 → technical_indicators 적재 (멱등).
 */

import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IndicatorBackfillService } from './indicator-backfill.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('indicators')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('indicators')
export class IndicatorBackfillController {
  constructor(private readonly backfill: IndicatorBackfillService) {}

  @Post('backfill')
  @ApiOperation({
    summary: '기술지표 백필 (DB 일봉 → technical_indicators, 멱등)',
  })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: ['latest', 'all'],
    description: 'latest=종목별 최신 거래일 1건 / all=보유 전 거래일 (기본 latest)',
  })
  async runBackfill(@Query('mode') mode?: 'latest' | 'all') {
    const result = await this.backfill.backfill({ mode: mode === 'all' ? 'all' : 'latest' });
    return { success: true, data: result };
  }
}
