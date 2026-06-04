import { Module } from '@nestjs/common';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { SummaryTask } from './tasks/summary.task';
import { EventClassificationTask } from './tasks/event-classification.task';
import { PersonaInterpretationTask } from './tasks/persona-interpretation.task';
import { PositionThesisTask } from './tasks/position-thesis.task';

/**
 * Engine 2 — AI Analyst Engine (M3).
 * 4개 AI Task + 비용 게이트(L0~L3) + 사용량 로그.
 * AI 금지영역: 최종 주문 승인·하드룰·한도·수량 결정에 절대 개입하지 않는다.
 * 설계: docs/roadmap/cc-engine-architecture.md §4-4, phase-04, phase-11
 */
@Module({
  providers: [
    AiCostGateService,
    AiUsageLogService,
    SummaryTask,
    EventClassificationTask,
    PersonaInterpretationTask,
    PositionThesisTask,
  ],
  exports: [
    AiCostGateService,
    AiUsageLogService,
    SummaryTask,
    EventClassificationTask,
    PersonaInterpretationTask,
    PositionThesisTask,
  ],
})
export class AiAnalystModule {}
