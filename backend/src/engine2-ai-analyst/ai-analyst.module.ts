import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiCostLimitGuardService } from './cost-gate/ai-cost-limit-guard.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { AiCostAggregationService } from './cost-aggregation/ai-cost-aggregation.service';
import { AiCostHealthService } from './cost-metrics/ai-cost-health.service';
import { AiCoverageMetricsService } from './cost-metrics/ai-coverage-metrics.service';
import { AiCostMonitorScheduler } from './cost-metrics/ai-cost-monitor.scheduler';
import { AiCostMetricsController } from './cost-metrics/ai-cost-metrics.controller';
import { AiAnalystService } from './ai-analyst.service';
import { SummaryTask } from './tasks/summary.task';
import { EventClassificationTask } from './tasks/event-classification.task';
import { PersonaInterpretationTask } from './tasks/persona-interpretation.task';
import { PositionThesisTask } from './tasks/position-thesis.task';
import { LlmClient } from './llm/llm-client';
import { HttpLlmClient } from './llm/http-llm-client';
import { AiAnalysisRepository } from './ports/ai-analysis.repository';
import { PrismaAiAnalysisRepository } from './adapters/prisma-ai-analysis.repository';
import { EventExtractedConsumer } from './consumers/event-extracted.consumer';
import { PriceMoveReasonConsumer } from './consumers/price-move-reason.consumer';
import { AiBackfillDrainService } from './backfill/ai-backfill-drain.service';
import { AiBackfillScheduler } from './backfill/ai-backfill.scheduler';
import { MarketDataModule } from '../engine3-quant-market/market-data/market-data.module';
import { EventStudyModule } from '../engine3-quant-market/event-study/event-study.module';
import { QUEUE } from '../common/queues/queue.constants';
import { NotificationProducerModule } from '../notifications/notification-producer.module';
// DAR-522: PRICE_MOVE 역방향 리즈닝(설명층) — 5번째 AI Task + 오케스트레이터 + refId 멱등 캐시.
import { PriceMoveReasoningTask } from './price-move-reasoning/price-move-reasoning.task';
import { PriceMoveReasoningService } from './price-move-reasoning/price-move-reasoning.service';
import { PriceMoveReasoningRepository } from './price-move-reasoning/price-move-reasoning.repository';
import { PrismaPriceMoveReasoningRepository } from './price-move-reasoning/prisma-price-move-reasoning.repository';

/**
 * Engine 2 — AI Analyst Engine (M3).
 * 헥사고날: LlmClient(포트)·AiAnalysisRepository(포트)를 어댑터로 바인딩한다.
 * - LLM: HttpLlmClient (OpenAI 호환, 키 없으면 호출 시 실패)
 * - 영속: PrismaAiAnalysisRepository (DisclosureAnalysis·PersonaAnalysis·AIUsageLog, M3)
 * - 큐: EventExtractedConsumer (Engine1→Engine2 비동기 AI 분석 트리거, M3-B)
 *
 * AI 금지영역: 최종 주문 승인·하드룰·한도·수량 결정에 절대 개입하지 않는다.
 * 설계: docs/roadmap/cc-engine-architecture.md §4-4, phase-04, phase-11
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE.AI_ANALYZE }),
    // DAR-522: engine3 PRICE_MOVE → engine2 역방향 리즈닝 트리거 큐.
    BullModule.registerQueue({ name: QUEUE.PRICE_MOVE_REASON }),
    MarketDataModule, // DAR-69: DartStockStatusService (관리종목 실데이터 폴백)
    EventStudyModule, // DAR-522: DisclosureReactionStatsService (EventStudy 유사사례 통계 주입)
    NotificationProducerModule, // DAR-476(P02): AI 비용 위반 OPS_ALERT 발행
  ],
  controllers: [AiCostMetricsController],
  providers: [
    AiAnalystService,
    AiCostGateService,
    AiCostLimitGuardService,
    AiUsageLogService,
    AiCostAggregationService,
    AiCostHealthService,
    AiCoverageMetricsService, // W10: 커버리지 계기판(생성률·P50/P95 지연) — 순수 DB 집계
    AiCostMonitorScheduler,
    SummaryTask,
    EventClassificationTask,
    PersonaInterpretationTask,
    PositionThesisTask,
    { provide: LlmClient, useClass: HttpLlmClient },
    PrismaAiAnalysisRepository,
    { provide: AiAnalysisRepository, useClass: PrismaAiAnalysisRepository },
    EventExtractedConsumer,
    // DAR-522: 역방향 리즈닝 — Task·오케스트레이터·refId 멱등 캐시 포트·큐 컨슈머.
    PriceMoveReasoningTask,
    PriceMoveReasoningService,
    PrismaPriceMoveReasoningRepository,
    { provide: PriceMoveReasoningRepository, useClass: PrismaPriceMoveReasoningRepository },
    PriceMoveReasonConsumer,
    AiBackfillDrainService,
    AiBackfillScheduler,
  ],
  exports: [AiAnalystService, AiCostGateService, AiCostLimitGuardService, AiUsageLogService, AiCostAggregationService, AiCostHealthService],
})
export class AiAnalystModule {}
