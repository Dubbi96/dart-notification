import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { KrxApiService } from './krx-api.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { DartStockStatusService } from './dart-stock-status.service';
import { MarketDataController } from './market-data.controller';
import { StockStatusController } from './stock-status.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarketDataController, StockStatusController],
  providers: [MarketDataService, KrxApiService, KrxMarketDataScheduler, DartStockStatusService],
  exports: [MarketDataService, KrxApiService, KrxMarketDataScheduler, DartStockStatusService],
})
export class MarketDataModule {}
