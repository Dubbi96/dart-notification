import { Module } from '@nestjs/common';
import { MarketDataModule } from './market-data/market-data.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { EventStudyModule } from './event-study/event-study.module';
import { BuySignalModule } from './buy-signal/buy-signal.module';
import { BacktestModule } from './backtest/backtest.module';
import { SignalGenerationModule } from './signal-generation/signal-generation.module';
import { PriceMoveAlertModule } from './price-move-alert/price-move-alert.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SignalsController } from './signals/signals.controller';
import { SignalsService } from './signals/signals.service';

/**
 * Engine 3 — Quant Market Engine.
 * 시세 수집·기술지표·이벤트스터디·매수신호·백테스트 도메인.
 * M9-A: BacktestModule(BacktestRun/Trade + lookahead bias 방지 + 현실제약) 추가.
 *
 * AI 금지영역: Buy Score·백테스트 로직·체결 시뮬에 AI 개입 절대 금지.
 * 설계: docs/roadmap/cc-engine-architecture.md §3·§4-5, phase-05, phase-10
 */
@Module({
  imports: [MarketDataModule, IndicatorsModule, EventStudyModule, BuySignalModule, BacktestModule, SignalGenerationModule, PriceMoveAlertModule, PrismaModule],
  controllers: [SignalsController],
  providers: [SignalsService],
  // NestJS는 import한 모듈의 provider를 개별 re-export 불가 → 모듈 자체를 re-export한다.
  // (각 서브모듈이 자신의 서비스를 exports하므로, 이 모듈을 import하면 그 서비스들을 주입받을 수 있다.)
  exports: [MarketDataModule, IndicatorsModule, EventStudyModule, BuySignalModule, BacktestModule, SignalGenerationModule, PriceMoveAlertModule],
})
export class QuantMarketModule {}
