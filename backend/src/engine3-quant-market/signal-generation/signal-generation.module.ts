import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BuySignalModule } from '../buy-signal/buy-signal.module';
import { SignalGenerationService } from './signal-generation.service';
import { SignalGenerationScheduler } from './signal-generation.scheduler';
import { SignalGenerationController } from './signal-generation.controller';
import { NotificationProducerModule } from '../../notifications/notification-producer.module';

/**
 * 런타임 신호 생성 모듈 — DAR-41.
 * BuyScore → TradingSignal persist 파이프라인 링크.
 */
@Module({
  imports: [PrismaModule, BuySignalModule, NotificationProducerModule],
  controllers: [SignalGenerationController],
  providers: [SignalGenerationService, SignalGenerationScheduler],
  exports: [SignalGenerationService],
})
export class SignalGenerationModule {}
