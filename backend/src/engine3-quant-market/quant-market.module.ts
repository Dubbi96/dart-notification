import { Module } from '@nestjs/common';
import { MarketDataModule } from './market-data/market-data.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { EventStudyModule } from './event-study/event-study.module';
import { BuySignalModule } from './buy-signal/buy-signal.module';
import { BacktestModule } from './backtest/backtest.module';
import { MarketDataService } from './market-data/market-data.service';
import { KrxApiService } from './market-data/krx-api.service';
import { KrxMarketDataScheduler } from './market-data/krx-market-data.scheduler';
import { TechnicalIndicatorService } from './indicators/technical-indicator.service';
import { EventStudyService } from './event-study/event-study.service';
import { BuySignalService } from './buy-signal/buy-signal.service';
import { MarketCalendarService } from './backtest/constraint/market-calendar.service';
import { PriceConstraintService } from './backtest/constraint/price-constraint.service';
import { PerformanceCalculatorService } from './backtest/metrics/performance-calculator.service';
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
  imports: [MarketDataModule, IndicatorsModule, EventStudyModule, BuySignalModule, BacktestModule, PrismaModule],
  controllers: [SignalsController],
  providers: [SignalsService],
  exports: [
    MarketDataService,
    KrxApiService,
    KrxMarketDataScheduler,
    TechnicalIndicatorService,
    EventStudyService,
    BuySignalService,
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
  ],
})
export class QuantMarketModule {}
