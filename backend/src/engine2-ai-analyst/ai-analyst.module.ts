import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiCostLimitGuardService } from './cost-gate/ai-cost-limit-guard.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { AiCostAggregationService } from './cost-aggregation/ai-cost-aggregation.service';
import { AiCostHealthService } from './cost-metrics/ai-cost-health.service';
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
import { AiBackfillDrainService } from './backfill/ai-backfill-drain.service';
import { AiBackfillScheduler } from './backfill/ai-backfill.scheduler';
import { MarketDataModule } from '../engine3-quant-market/market-data/market-data.module';
import { QUEUE } from '../common/queues/queue.constants';

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
    MarketDataModule, // DAR-69: DartStockStatusService (관리종목 실데이터 폴백)
  ],
  controllers: [AiCostMetricsController],
  providers: [
    AiAnalystService,
    AiCostGateService,
    AiCostLimitGuardService,
    AiUsageLogService,
    AiCostAggregationService,
    AiCostHealthService,
    AiCostMonitorScheduler,
    SummaryTask,
    EventClassificationTask,
    PersonaInterpretationTask,
    PositionThesisTask,
    { provide: LlmClient, useClass: HttpLlmClient },
    PrismaAiAnalysisRepository,
    { provide: AiAnalysisRepository, useClass: PrismaAiAnalysisRepository },
    EventExtractedConsumer,
    AiBackfillDrainService,
    AiBackfillScheduler,
  ],
  exports: [AiAnalystService, AiCostGateService, AiCostLimitGuardService, AiUsageLogService, AiCostAggregationService, AiCostHealthService],
})
export class AiAnalystModule {}
