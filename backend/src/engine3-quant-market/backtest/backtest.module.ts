import { Module } from '@nestjs/common';
import { MarketCalendarService } from './constraint/market-calendar.service';
import { PriceConstraintService } from './constraint/price-constraint.service';
import { PerformanceCalculatorService } from './metrics/performance-calculator.service';

// BacktestRunnerService는 PriceDataPort 구현체 주입이 필요하므로 이 모듈에서 제공/내보내지 않는다.
// 사용 측(백테스트 실행 컨텍스트)에서 port 구현체와 함께 provider로 등록한다.
@Module({
  providers: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
  ],
  exports: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
  ],
})
export class BacktestModule {}
