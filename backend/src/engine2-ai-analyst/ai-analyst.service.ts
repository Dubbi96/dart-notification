import { Injectable, Logger } from '@nestjs/common';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { AiAnalysisRepository } from './ports/ai-analysis.repository';
import { SummaryTask, SummaryTaskInput, DisclosureSummaryDraft } from './tasks/summary.task';
import {
  EventClassificationTask,
  EventClassificationInput,
  EventClassificationDraft,
} from './tasks/event-classification.task';
import {
  PersonaInterpretationTask,
  PersonaInterpretationInput,
  PersonaAnalysisDraft,
} from './tasks/persona-interpretation.task';
import {
  PositionThesisTask,
  PositionThesisInput,
  PositionThesisDraft,
} from './tasks/position-thesis.task';
import { estimateCostUsd } from './pricing/estimate-cost';
import { AiCostLevel, AiGateInput } from './types/ai-analyst.types';

export interface SummaryRequest {
  gate: AiGateInput;
  input: SummaryTaskInput;
}

export interface EventClassificationRequest {
  gate: AiGateInput;
  input: EventClassificationInput;
}

export interface PersonaInterpretationRequest {
  gate: AiGateInput;
  input: PersonaInterpretationInput;
}

export interface PositionThesisRequest {
  gate: AiGateInput;
  input: PositionThesisInput;
}

/**
 * Engine2 오케스트레이터.
 * 흐름: 멱등 캐시 조회 → 비용 게이트 → Task 실행 → 결과 영속 → 사용량(비용) 기록.
 * AI 금지영역: 산출물은 참고 정보일 뿐, 어떤 주문/리스크 결정도 내리지 않는다.
 */
@Injectable()
export class AiAnalystService {
  private readonly logger = new Logger(AiAnalystService.name);

  constructor(
    private readonly gate: AiCostGateService,
    private readonly repo: AiAnalysisRepository,
    private readonly usageLog: AiUsageLogService,
    private readonly summaryTask: SummaryTask,
    private readonly eventClassificationTask: EventClassificationTask,
    private readonly personaInterpretationTask: PersonaInterpretationTask,
    private readonly positionThesisTask: PositionThesisTask,
  ) {}

  /**
   * 공시 요약(L2). 게이트가 L0면 분석을 건너뛰고 null 반환(AI 미호출).
   * 동일 rcpNo+task 재요청은 캐시를 반환(멱등).
   */
  async runSummary(req: SummaryRequest): Promise<DisclosureSummaryDraft | null> {
    const { rcpNo } = req.input;

    const cached = await this.repo.findAnalysis(rcpNo, 'summary');
    if (cached) {
      return cached.resultJson as DisclosureSummaryDraft;
    }

    const level = this.gate.evaluateGate(req.gate);
    if (level === AiCostLevel.L0) {
      this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} L0 — 분석 스킵`);
      return null;
    }

    const { result, usage } = await this.summaryTask.run(req.input);

    await this.repo.saveAnalysis({
      rcpNo,
      task: 'summary',
      level,
      resultJson: result,
      createdAt: new Date(),
    });

    await this.usageLog.logUsage({
      rcpNo,
      task: 'summary',
      level,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateCostUsd(usage),
    });

    return result;
  }

  /**
   * 이벤트 분류 보정(L1). 게이트가 L0면 스킵하고 null 반환.
   * 동일 rcpNo+task 재요청은 캐시를 반환(멱등).
   */
  async runEventClassification(
    req: EventClassificationRequest,
  ): Promise<EventClassificationDraft | null> {
    const { rcpNo } = req.input;

    const cached = await this.repo.findAnalysis(rcpNo, 'event-classification');
    if (cached) {
      return cached.resultJson as EventClassificationDraft;
    }

    const level = this.gate.evaluateGate(req.gate);
    if (level === AiCostLevel.L0) {
      this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} L0 — event-classification 스킵`);
      return null;
    }

    const { result, usage } = await this.eventClassificationTask.run(req.input);

    await this.repo.saveAnalysis({
      rcpNo,
      task: 'event-classification',
      level,
      resultJson: result,
      createdAt: new Date(),
    });

    await this.usageLog.logUsage({
      rcpNo,
      task: 'event-classification',
      level,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateCostUsd(usage),
    });

    return result;
  }

  /**
   * Persona 해석(L2). 게이트가 L0/L1이면 스킵하고 null 반환.
   * 동일 rcpNo+task 재요청은 캐시를 반환(멱등).
   */
  async runPersonaInterpretation(
    req: PersonaInterpretationRequest,
  ): Promise<PersonaAnalysisDraft[] | null> {
    const { rcpNo } = req.input;

    const cached = await this.repo.findAnalysis(rcpNo, 'persona-interpretation');
    if (cached) {
      return cached.resultJson as PersonaAnalysisDraft[];
    }

    const level = this.gate.evaluateGate(req.gate);
    if (level === AiCostLevel.L0 || level === AiCostLevel.L1) {
      this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} ${level} — persona-interpretation 스킵`);
      return null;
    }

    const { result, usage } = await this.personaInterpretationTask.run(req.input);

    await this.repo.saveAnalysis({
      rcpNo,
      task: 'persona-interpretation',
      level,
      resultJson: result,
      createdAt: new Date(),
    });

    await this.usageLog.logUsage({
      rcpNo,
      task: 'persona-interpretation',
      level,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateCostUsd(usage),
    });

    return result;
  }

  /**
   * Position Thesis 초안(L3). 게이트가 L3 미만이면 스킵하고 null 반환.
   * 동일 rcpNo+task 재요청은 캐시를 반환(멱등).
   */
  async runPositionThesis(req: PositionThesisRequest): Promise<PositionThesisDraft | null> {
    const { rcpNo } = req.input;

    const cached = await this.repo.findAnalysis(rcpNo, 'position-thesis');
    if (cached) {
      return cached.resultJson as PositionThesisDraft;
    }

    const level = this.gate.evaluateGate(req.gate);
    if (level !== AiCostLevel.L3) {
      this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} ${level} — position-thesis 스킵(L3 전용)`);
      return null;
    }

    const { result, usage } = await this.positionThesisTask.run(req.input);

    await this.repo.saveAnalysis({
      rcpNo,
      task: 'position-thesis',
      level,
      resultJson: result,
      createdAt: new Date(),
    });

    await this.usageLog.logUsage({
      rcpNo,
      task: 'position-thesis',
      level,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateCostUsd(usage),
    });

    return result;
  }
}
