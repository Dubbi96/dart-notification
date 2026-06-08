import { Module } from '@nestjs/common';
import { EventStudyService } from './event-study.service';
import { EventStudyQueryService } from './event-study-query.service';
import { EventStudyCalculationService } from './event-study-calculation.service';
import { EventStudyController } from './event-study.controller';
import { STOCK_PRICE_PORT } from './ports/stock-price.port';
import { MARKET_INDEX_PORT } from './ports/market-index.port';
import { PrismaStockPriceAdapter } from './adapters/prisma-stock-price.adapter';
import { PrismaMarketIndexAdapter } from './adapters/prisma-market-index.adapter';

@Module({
  controllers: [EventStudyController],
  providers: [
    EventStudyService,
    EventStudyQueryService,
    EventStudyCalculationService,
    // 산출 가격 데이터 포트 → 실 DB Prisma 어댑터 (DAR-133)
    { provide: STOCK_PRICE_PORT, useClass: PrismaStockPriceAdapter },
    { provide: MARKET_INDEX_PORT, useClass: PrismaMarketIndexAdapter },
  ],
  exports: [EventStudyService, EventStudyQueryService, EventStudyCalculationService],
})
export class EventStudyModule {}
