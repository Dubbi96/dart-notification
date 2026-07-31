import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BuySignalModule } from '../buy-signal/buy-signal.module';
import { SignalGenerationService } from './signal-generation.service';
import { SignalGenerationScheduler } from './signal-generation.scheduler';
import { SignalGenerationController } from './signal-generation.controller';
import { NotificationProducerModule } from '../../notifications/notification-producer.module';
import { BacktestModule } from '../backtest/backtest.module';
import { FeatureEngineModule } from '../../aos/feature-engine/feature-engine.module';

/**
 * 런타임 신호 생성 모듈 — DAR-41.
 * BuyScore → TradingSignal persist 파이프라인 링크.
 * DAR-91: BacktestModule(SignalAccuracyService) 주입으로 calibration 등급 보정계수 환류.
 */
@Module({
  imports: [
    PrismaModule,
    BuySignalModule,
    NotificationProducerModule,
    BacktestModule,
    FeatureEngineModule,
  ],
  controllers: [SignalGenerationController],
  providers: [SignalGenerationService, SignalGenerationScheduler],
  exports: [SignalGenerationService],
})
export class SignalGenerationModule {}
