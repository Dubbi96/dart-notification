import { Module } from '@nestjs/common';
import { EventStudyService } from './event-study.service';
import { EventStudyQueryService } from './event-study-query.service';
import { EventStudyCalculationService } from './event-study-calculation.service';
import { EventStudyCalculationScheduler } from './event-study-calculation.scheduler';
import { EventStudyController } from './event-study.controller';
import { DisclosureReactionStatsController } from './disclosure-reaction-stats.controller';
import { DisclosureReactionStatsService } from './disclosure-reaction-stats.service';
import { STOCK_PRICE_PORT } from './ports/stock-price.port';
import { MARKET_INDEX_PORT } from './ports/market-index.port';
import { PrismaStockPriceAdapter } from './adapters/prisma-stock-price.adapter';
import { PrismaMarketIndexAdapter } from './adapters/prisma-market-index.adapter';

@Module({
  // DAR-511: 유사공시 반응 통계는 스펙 경로(/disclosures/:rcpNo/event-stats)를 따르되
  // 로직을 engine3 에 두어 engine1 무변경 유지 → 전용 컨트롤러로 분리.
  controllers: [EventStudyController, DisclosureReactionStatsController],
  providers: [
    EventStudyService,
    EventStudyQueryService,
    EventStudyCalculationService,
    // DAR-511: 유사공시 반응 통계 조회(코어스 버킷 EventStudyResult 재사용·일1회 캐시)
    DisclosureReactionStatsService,
    // DAR-134: 주간 baseline 산출 cron (historicalEvent 버킷 영구 결측 해소)
    EventStudyCalculationScheduler,
    // 산출 가격 데이터 포트 → 실 DB Prisma 어댑터 (DAR-133)
    { provide: STOCK_PRICE_PORT, useClass: PrismaStockPriceAdapter },
    { provide: MARKET_INDEX_PORT, useClass: PrismaMarketIndexAdapter },
  ],
  // DAR-522: 역방향 리즈닝(engine2)이 EventStudy 유사사례 통계를 주입받도록 노출.
  exports: [
    EventStudyService,
    EventStudyQueryService,
    EventStudyCalculationService,
    DisclosureReactionStatsService,
  ],
})
export class EventStudyModule {}
