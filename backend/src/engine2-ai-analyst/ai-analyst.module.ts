import { Module } from '@nestjs/common';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { AiAnalystService } from './ai-analyst.service';
import { SummaryTask } from './tasks/summary.task';
import { EventClassificationTask } from './tasks/event-classification.task';
import { PersonaInterpretationTask } from './tasks/persona-interpretation.task';
import { PositionThesisTask } from './tasks/position-thesis.task';
import { LlmClient } from './llm/llm-client';
import { HttpLlmClient } from './llm/http-llm-client';
import { AiAnalysisRepository } from './ports/ai-analysis.repository';
import { PrismaAiAnalysisRepository } from './adapters/prisma-ai-analysis.repository';

/**
 * Engine 2 — AI Analyst Engine (M3).
 * 헥사고날: LlmClient(포트)·AiAnalysisRepository(포트)를 어댑터로 바인딩한다.
 * - LLM: HttpLlmClient (OpenAI 호환, 키 없으면 호출 시 실패)
 * - 영속: PrismaAiAnalysisRepository (DisclosureAnalysis·PersonaAnalysis·AIUsageLog, M3)
 *
 * AI 금지영역: 최종 주문 승인·하드룰·한도·수량 결정에 절대 개입하지 않는다.
 * 설계: docs/roadmap/cc-engine-architecture.md §4-4, phase-04, phase-11
 */
@Module({
  providers: [
    AiAnalystService,
    AiCostGateService,
    AiUsageLogService,
    SummaryTask,
    EventClassificationTask,
    PersonaInterpretationTask,
    PositionThesisTask,
    { provide: LlmClient, useClass: HttpLlmClient },
    PrismaAiAnalysisRepository,
    { provide: AiAnalysisRepository, useClass: PrismaAiAnalysisRepository },
  ],
  exports: [AiAnalystService, AiCostGateService, AiUsageLogService],
})
export class AiAnalystModule {}
