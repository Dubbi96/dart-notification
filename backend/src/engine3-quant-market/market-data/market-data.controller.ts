import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('Market Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('market-data')
export class MarketDataController {
  constructor(private readonly scheduler: KrxMarketDataScheduler) {}

  @Post('collect/daily')
  @ApiOperation({ summary: 'KRX 일봉 수동 수집 (날짜 지정)' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectDaily(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectDailyPricesForDate(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('collect/indices')
  @ApiOperation({ summary: 'KRX 시장지수 수동 수집' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectIndices(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectMarketIndicesForDate(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('collect/status')
  @ApiOperation({ summary: 'KRX 종목상태 수동 수집' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectStatus(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectStockStatusesForDate(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Post('collect/all')
  @ApiOperation({ summary: 'KRX EOD 통합 수집 (일봉+지수+종목상태)' })
  @ApiQuery({ name: 'basDd', required: true, description: '기준일 YYYYMMDD' })
  async collectAll(@Query('basDd') basDd: string) {
    const result = await this.scheduler.collectAll(basDd, 'MANUAL');
    return { success: true, data: result };
  }

  @Get('collection-logs')
  @ApiOperation({ summary: '시세 수집 이력 조회 (최근 20건)' })
  @ApiQuery({ name: 'tradeDate', required: false, description: '날짜 필터 YYYYMMDD' })
  async getCollectionLogs(@Query('tradeDate') tradeDate?: string) {
    return this.scheduler.getCollectionLogs(tradeDate);
  }
}
