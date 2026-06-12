import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { StockQuoteService } from './stock-quote.service';
import { KrxApiService } from './krx-api.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { DartStockStatusService } from './dart-stock-status.service';
import { MarketDataController } from './market-data.controller';
import { StockStatusController } from './stock-status.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { KisApiService } from './kis-api.service';
import { KisRealtimePoller } from './kis-realtime.poller';
import { RealtimeQuoteModule } from './realtime-quote.module';

@Module({
  // RealtimeQuoteModule(@Global): RealtimeQuoteCache 단일 인스턴스를 폴러↔모의평가가 공유(DAR-140).
  imports: [PrismaModule, RealtimeQuoteModule],
  controllers: [MarketDataController, StockStatusController],
  providers: [
    MarketDataService,
    StockQuoteService,
    KrxApiService,
    KrxMarketDataScheduler,
    DartStockStatusService,
    // DAR-140: KIS 실시간 어댑터 + 폴러(키 미설정 시 graceful no-op).
    KisApiService,
    KisRealtimePoller,
  ],
  exports: [
    MarketDataService,
    StockQuoteService,
    KrxApiService,
    KrxMarketDataScheduler,
    DartStockStatusService,
    KisApiService,
  ],
})
export class MarketDataModule {}
