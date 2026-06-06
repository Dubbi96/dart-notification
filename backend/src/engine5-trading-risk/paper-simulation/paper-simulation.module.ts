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
import { NotificationProducerModule } from '../../notifications/notification-producer.module';
import { NotificationProducerService } from '../../notifications/notification-producer.service';

@Module({
  imports: [PrismaModule, TradingRiskModule, NotificationProducerModule],
  controllers: [PaperSimulationController],
  providers: [
    PaperSimulationScheduler,
    {
      provide: PaperSimulationService,
      // DAR-85: NotificationProducerService 주입(청산 권고 enqueue). optional:true 로
      // 큐 미설정 환경에서도 안전(producer 내부도 @Optional 큐로 graceful).
      useFactory: (
        prisma: PrismaService,
        paperTrade: PaperTradeService,
        notifyProducer?: NotificationProducerService,
      ) => new PaperSimulationService(prisma, paperTrade, notifyProducer),
      inject: [
        PrismaService,
        PaperTradeService,
        { token: NotificationProducerService, optional: true },
      ],
    },
  ],
  exports: [PaperSimulationService],
})
export class PaperSimulationModule {}
