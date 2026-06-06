import { Module } from '@nestjs/common';
import { MarketCalendarService } from './constraint/market-calendar.service';
import { PriceConstraintService } from './constraint/price-constraint.service';
import { PerformanceCalculatorService } from './metrics/performance-calculator.service';
import { SignalAccuracyService } from './signal-accuracy.service';
import { SignalAccuracyController } from './signal-accuracy.controller';

// BacktestRunnerService는 PriceDataPort 구현체 주입이 필요하므로 이 모듈에서 제공/내보내지 않는다.
// 사용 측(백테스트 실행 컨텍스트)에서 port 구현체와 함께 provider로 등록한다.
// SignalAccuracyService는 PrismaService(@Global)만 의존하므로 여기서 read-only 조회로 제공한다(DAR-73).
@Module({
  controllers: [SignalAccuracyController],
  providers: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
    SignalAccuracyService,
  ],
  exports: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
    SignalAccuracyService,
  ],
})
export class BacktestModule {}
