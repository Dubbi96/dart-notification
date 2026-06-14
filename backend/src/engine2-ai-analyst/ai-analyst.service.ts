import { Injectable, Logger } from '@nestjs/common';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiCostLimitGuardService } from './cost-gate/ai-cost-limit-guard.service';
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
import { estimateCostUsd, isPricedModel } from './pricing/estimate-cost';
import { AiCostLevel, AiGateInput, TaskUsage } from './types/ai-analyst.types';

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
 * 흐름: 멱등 캐시 조회 → 비용 게이트 → **한도 가드(일/월)** → Task 실행 → 결과 영속 → 사용량(비용) 기록.
 * AI 금지영역: 산출물은 참고 정보일 뿐, 어떤 주문/리스크 결정도 내리지 않는다.
 *
 * DAR-78: 비용 폭주 방지를 위해 게이트 레벨에 AiCostLimitGuard(일 $1·월 $20) 한도를
 * 강제 적용한다 — 한도 초과 시 모든 Task가 L0(미호출)로 강등된다.
 */
@Injectable()
export class AiAnalystService {
  private readonly logger = new Logger(AiAnalystService.name);
  /** 단가표 미매칭으로 경보한 모델명(프로세스 단위 1회 경보 — 로그 폭주 방지). DAR-244. */
  private readonly unpricedModelsWarned = new Set<string>();

  constructor(
    private readonly gate: AiCostGateService,
    private readonly limitGuard: AiCostLimitGuardService,
    private readonly repo: AiAnalysisRepository,
    private readonly usageLog: AiUsageLogService,
    private readonly summaryTask: SummaryTask,
    private readonly eventClassificationTask: EventClassificationTask,
    private readonly personaInterpretationTask: PersonaInterpretationTask,
    private readonly positionThesisTask: PositionThesisTask,
  ) {}

  /**
   * 게이트 레벨을 산출하고 일/월 비용 한도를 강제 적용한다(DAR-78).
   * 한도 초과 시 AiCostLimitGuard가 L0으로 강등 → 유료 호출 차단.
   */
  private async resolveLevel(gate: AiGateInput): Promise<AiCostLevel> {
    const proposed = this.gate.evaluateGate(gate);
    return this.limitGuard.enforceLimit(proposed);
  }

  /**
   * 추정비용을 계산하되, 모델 단가표 미매칭(DEFAULT_PRICE 조용한 폴백)을 경보한다(DAR-244).
   * 미매칭 추정비용은 실청구와 달라 AIUsageLog·한도가드 정확도를 직접 떨어뜨리므로
   * 모델당 1회 warn으로 노출한다. estimate-cost.ts PRICE_PER_1K 갱신이 필요하다는 신호.
   */
  private costUsdFor(usage: TaskUsage): number {
    if (!isPricedModel(usage.model)) {
      const model = usage.model && usage.model.length > 0 ? usage.model : '(unset)';
      if (!this.unpricedModelsWarned.has(model)) {
        this.unpricedModelsWarned.add(model);
        this.logger.warn(
          `[AiAnalyst] 미등록 모델 단가 — model="${model}" PRICE_PER_1K 미매칭 → DEFAULT_PRICE 폴백. ` +
            `추정비용이 실청구와 달라 AIUsageLog·비용 한도집계가 부정확할 수 있음(DAR-244). ` +
            `pricing/estimate-cost.ts PRICE_PER_1K에 해당 모델 단가 추가 필요.`,
        );
      }
    }
    return estimateCostUsd(usage);
  }

  /**
   * 공시 요약(L2). 게이트가 L0면 분석을 건너뛰고 null 반환(AI 미호출).
   * 동일 rcpNo+task 재요청은 캐시를 반환(멱등).
   */
  async runSummary(req: SummaryRequest): Promise<DisclosureSummaryDraft | null> {
    const { rcpNo } = req.input;

    const cached = await this.repo.findAnalysis(rcpNo, 'summary');
    if (cached) {
      // DAR-241: 캐시히트(비용0 재사용)를 관측 기록 — 재처리 통계에서 사라지지 않도록.
      await this.usageLog.logCacheHit({ rcpNo, task: 'summary', level: cached.level });
      return cached.resultJson as DisclosureSummaryDraft;
    }

    const level = await this.resolveLevel(req.gate);
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
      costUsd: this.costUsdFor(usage),
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
      // DAR-241: 캐시히트(비용0 재사용)를 관측 기록.
      await this.usageLog.logCacheHit({ rcpNo, task: 'event-classification', level: cached.level });
      return cached.resultJson as EventClassificationDraft;
    }

    const level = await this.resolveLevel(req.gate);
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
      costUsd: this.costUsdFor(usage),
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
      // DAR-241: 캐시히트(비용0 재사용)를 관측 기록.
      await this.usageLog.logCacheHit({ rcpNo, task: 'persona-interpretation', level: cached.level });
      return cached.resultJson as PersonaAnalysisDraft[];
    }

    const level = await this.resolveLevel(req.gate);
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

    // DAR-78: PersonaAnalysis 테이블에도 영속 — DAR-72 P-C 융합 엔진의 personaViews 입력 소스.
    await this.repo.savePersonaViews(rcpNo, result);

    await this.usageLog.logUsage({
      rcpNo,
      task: 'persona-interpretation',
      level,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: this.costUsdFor(usage),
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
      // DAR-241: 캐시히트(비용0 재사용)를 관측 기록.
      await this.usageLog.logCacheHit({ rcpNo, task: 'position-thesis', level: cached.level });
      return cached.resultJson as PositionThesisDraft;
    }

    const level = await this.resolveLevel(req.gate);
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
      costUsd: this.costUsdFor(usage),
    });

    return result;
  }
}
