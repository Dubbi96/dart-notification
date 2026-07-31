import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { MarketCalendarService } from '../../engine3-quant-market/backtest/constraint/market-calendar.service';
import { PriceConstraintService } from '../../engine3-quant-market/backtest/constraint/price-constraint.service';
import { PerformanceCalculatorService } from '../../engine3-quant-market/backtest/metrics/performance-calculator.service';
import { RecordAosBacktestRunService } from './services/record-aos-backtest-run.service';
import { RunAosBacktestService } from './services/run-aos-backtest.service';

@Module({
  imports: [PrismaModule],
  providers: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
    RecordAosBacktestRunService,
    RunAosBacktestService,
  ],
  exports: [RecordAosBacktestRunService, RunAosBacktestService],
})
export class AosBacktestModule {}
