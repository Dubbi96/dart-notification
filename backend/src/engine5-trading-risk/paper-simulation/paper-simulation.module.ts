/**
 * PaperSimulationModule — 일일 모의운용 오케스트레이터 (M10 모의운용, DAR-40)
 *
 * AI 금지영역: 매수점수·Exit·체결은 순수 Rule. engine2/AI import 0.
 * PaperTradeService는 TradingRiskModule에서 주입(Prisma 리포지토리 배선 재사용).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { TradingRiskModule } from '../trading-risk.module';
import { PaperTradeService } from '../services/paper-trade.service';
import { PaperSimulationService } from './paper-simulation.service';
import { PaperSimulationController } from './paper-simulation.controller';
import { PaperSimulationScheduler } from './paper-simulation.scheduler';
import { SimulationPriceSourceService } from './simulation-price-source.service';
import { NotificationProducerModule } from '../../notifications/notification-producer.module';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
// DAR-366: 장중 손절 모니터의 능동 fetch 용 KIS 현재가 조회(KisApiService). RealtimeQuoteCache 는 @Global.
import { MarketDataModule } from '../../engine3-quant-market/market-data/market-data.module';
import { KisApiService } from '../../engine3-quant-market/market-data/kis-api.service';
import { RealtimeQuoteCache } from '../../engine3-quant-market/market-data/realtime-quote.cache';

@Module({
  imports: [PrismaModule, TradingRiskModule, NotificationProducerModule, MarketDataModule],
  controllers: [PaperSimulationController],
  providers: [
    PaperSimulationScheduler,
    // DAR-124/137: 시세 소스(REAL / SYNTHETIC / REAL_THEN_SYNTHETIC).
    //   PAPER_SIM_SYNTHETIC_FEED=합성 전용, PAPER_SIM_REAL_FEED=실가 우선·합성 폴백(하이브리드).
    SimulationPriceSourceService,
    {
      provide: PaperSimulationService,
      // DAR-85: NotificationProducerService 주입(청산 권고 enqueue). optional:true 로
      // 큐 미설정 환경에서도 안전(producer 내부도 @Optional 큐로 graceful).
      // DAR-124: SimulationPriceSourceService 주입(시세 소스 추상화).
      // DAR-366: KisApiService(능동 fetch)·RealtimeQuoteCache(@Global) 주입 — 둘 다 optional 로
      //   미설정/미주입 환경(테스트·키 없음)에서도 안전(능동 fetch no-op, 평가는 폴백).
      useFactory: (
        prisma: PrismaService,
        paperTrade: PaperTradeService,
        notifyProducer?: NotificationProducerService,
        priceSource?: SimulationPriceSourceService,
        kis?: KisApiService,
        realtimeCache?: RealtimeQuoteCache,
      ) =>
        new PaperSimulationService(
          prisma,
          paperTrade,
          notifyProducer,
          priceSource,
          kis,
          realtimeCache,
        ),
      inject: [
        PrismaService,
        PaperTradeService,
        { token: NotificationProducerService, optional: true },
        { token: SimulationPriceSourceService, optional: true },
        { token: KisApiService, optional: true },
        { token: RealtimeQuoteCache, optional: true },
      ],
    },
  ],
  exports: [PaperSimulationService],
})
export class PaperSimulationModule {}
