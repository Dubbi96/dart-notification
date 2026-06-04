import { Module } from '@nestjs/common';
import { BacktestRunnerService } from './backtest-runner.service';
import { MarketCalendarService } from './constraint/market-calendar.service';
import { PriceConstraintService } from './constraint/price-constraint.service';
import { PerformanceCalculatorService } from './metrics/performance-calculator.service';

@Module({
  providers: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
    // BacktestRunnerService는 PriceDataPort 구현체 주입 필요 — 사용 측에서 provider 등록
  ],
  exports: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
    BacktestRunnerService,
  ],
})
export class BacktestModule {}
