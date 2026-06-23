import { Module } from '@nestjs/common';
import { MarketCalendarService } from './constraint/market-calendar.service';
import { PriceConstraintService } from './constraint/price-constraint.service';
import { PerformanceCalculatorService } from './metrics/performance-calculator.service';
import { SignalAccuracyService } from './signal-accuracy.service';
import { EvaluationCorpusService } from './evaluation-corpus.service';
import { SignalAccuracyController } from './signal-accuracy.controller';
import { BacktestSignalAssemblyService } from './replay/backtest-signal-assembly.service';
import { BacktestReplayService } from './replay/backtest-replay.service';
import { BacktestReplayController } from './replay/backtest-replay.controller';
import { StrategyTrackService } from './strategies/strategy-track.service';
import { StrategyTrackController } from './strategies/strategy-track.controller';
import { StrategyTrackScheduler } from './strategies/strategy-track.scheduler';
import { EventEdgeSelectorService } from './strategies/event-edge-selector.service';
import { EventStudyModule } from '../event-study/event-study.module';

// BacktestRunnerService는 PriceDataPort 구현체 주입이 필요하므로 이 모듈에서 제공/내보내지 않는다.
// 사용 측(백테스트 실행 컨텍스트)에서 port 구현체와 함께 provider로 등록한다.
// SignalAccuracyService는 PrismaService(@Global)만 의존하므로 여기서 read-only 조회로 제공한다(DAR-73).
// DAR-385: BacktestReplayService 는 PrismaBacktestPriceAdapter 를 실행 시 직접 생성(per-run asOf)하므로
//   PriceDataPort 모듈 바인딩 없이도 point-in-time 1년 리플레이를 오케스트레이션한다.
@Module({
  imports: [EventStudyModule],
  controllers: [SignalAccuracyController, BacktestReplayController, StrategyTrackController],
  providers: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
    SignalAccuracyService,
    EvaluationCorpusService,
    BacktestSignalAssemblyService,
    BacktestReplayService,
    StrategyTrackService,
    StrategyTrackScheduler,
    EventEdgeSelectorService,
  ],
  exports: [
    MarketCalendarService,
    PriceConstraintService,
    PerformanceCalculatorService,
    SignalAccuracyService,
    EvaluationCorpusService,
    BacktestSignalAssemblyService,
    BacktestReplayService,
    StrategyTrackService,
  ],
})
export class BacktestModule {}
