import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { KrxApiService } from './krx-api.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { MarketDataController } from './market-data.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarketDataController],
  providers: [MarketDataService, KrxApiService, KrxMarketDataScheduler],
  exports: [MarketDataService, KrxApiService, KrxMarketDataScheduler],
})
export class MarketDataModule {}
