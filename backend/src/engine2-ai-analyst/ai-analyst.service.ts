import { Injectable, Logger } from '@nestjs/common';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiCostLimitGuardService, CostReservation } from './cost-gate/ai-cost-limit-guard.service';
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
import {
  AiCostLevel,
  AiGateInput,
  AiTaskName,
  TaskRunResult,
  TaskUsage,
  TaskParseFailureError,
} from './types/ai-analyst.types';

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
   *
   * DAR-242: 동시성 보호를 위해 한도 가드가 유료 호출 슬롯을 원자적으로 예약한다.
   * 반환된 CostReservation.settle()을 호출 완료 후 반드시 호출해야 한다(각 run* 메서드의 finally).
   */
  private async resolveLevel(gate: AiGateInput): Promise<CostReservation> {
    const proposed = this.gate.evaluateGate(gate);
    return this.limitGuard.enforceLimit(proposed);
  }

  /** 사용량(토큰) → AIUsageLog 영속. 비용은 토큰 발생 시점이 결정한다. */
  private async logTaskUsage(
    rcpNo: string,
    task: AiTaskName,
    level: AiCostLevel,
    usage: TaskUsage,
  ): Promise<void> {
    await this.usageLog.logUsage({
      rcpNo,
      task,
      level,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateCostUsd(usage),
    });
  }

  /**
   * Task 실행 래퍼(DAR-240).
   * LLM 호출은 성공(토큰 청구됨)했으나 JSON 파싱/검증이 실패하면(TaskParseFailureError)
   * 이미 발생한 토큰 비용을 AIUsageLog에 **먼저** 기록한 뒤 실패를 그대로 위로 전파한다.
   * → 유료 호출 성공인데 비용 0 누락(AIUsageLog 누락·한도가드 과소집계) 방지.
   */
  private async runTask<T>(
    rcpNo: string,
    task: AiTaskName,
    level: AiCostLevel,
    run: () => Promise<TaskRunResult<T>>,
  ): Promise<TaskRunResult<T>> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof TaskParseFailureError) {
        this.logger.warn(
          `[AiAnalyst] rcpNo=${rcpNo} task=${task} 파싱 실패 — usage 보존 기록 후 전파`,
        );
        await this.logTaskUsage(rcpNo, task, level, err.usage);
      }
      throw err;
    }
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

    const reservation = await this.resolveLevel(req.gate);
    const level = reservation.level;
    try {
      if (level === AiCostLevel.L0) {
        this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} L0 — 분석 스킵`);
        // DAR-239: L0(룰 기반·AI 미사용) 게이트 결정도 비용0 행으로 AIUsageLog에 기록한다.
        // runSummary는 공시당 1회 호출되는 진입 게이트이므로 이 1행이 곧 '공시당 게이트 평가'다
        // (하위 Persona/Thesis 스킵은 비L0 공시에서 중복 발생하므로 일부러 기록하지 않는다 — 분모 왜곡 방지).
        // 미기록 시 AIUsageLog의 L0 분자가 영구 0 → l0Ratio 구조적 0 → 회귀 게이트(L0≥70%) 거짓 발화.
        await this.usageLog.logUsage({
          rcpNo,
          task: 'summary',
          level: AiCostLevel.L0,
          model: '-',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        });
        return null;
      }

      const { result, usage } = await this.runTask(rcpNo, 'summary', level, () =>
        this.summaryTask.run(req.input),
      );

      await this.repo.saveAnalysis({
        rcpNo,
        task: 'summary',
        level,
        resultJson: result,
        createdAt: new Date(),
      });

      await this.logTaskUsage(rcpNo, 'summary', level, usage);

      return result;
    } finally {
      reservation.settle();
    }
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

    const reservation = await this.resolveLevel(req.gate);
    const level = reservation.level;
    try {
      if (level === AiCostLevel.L0) {
        this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} L0 — event-classification 스킵`);
        // DAR-239: 게이트 평가(L0 분자)는 진입 게이트 runSummary에서만 1행 기록한다.
        // 보조 Task 스킵까지 기록하면 동일 공시가 여러 행으로 중복 집계돼 l0Ratio 분모가 왜곡된다.
        return null;
      }

      const { result, usage } = await this.runTask(rcpNo, 'event-classification', level, () =>
        this.eventClassificationTask.run(req.input),
      );

      await this.repo.saveAnalysis({
        rcpNo,
        task: 'event-classification',
        level,
        resultJson: result,
        createdAt: new Date(),
      });

      await this.logTaskUsage(rcpNo, 'event-classification', level, usage);

      return result;
    } finally {
      reservation.settle();
    }
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

    const reservation = await this.resolveLevel(req.gate);
    const level = reservation.level;
    try {
      if (level === AiCostLevel.L0 || level === AiCostLevel.L1) {
        this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} ${level} — persona-interpretation 스킵`);
        // DAR-239: 진입 게이트(runSummary)에서만 게이트 결정을 기록한다(분모 왜곡 방지). 여기선 기록하지 않는다.
        return null;
      }

      const { result, usage } = await this.runTask(rcpNo, 'persona-interpretation', level, () =>
        this.personaInterpretationTask.run(req.input),
      );

      await this.repo.saveAnalysis({
        rcpNo,
        task: 'persona-interpretation',
        level,
        resultJson: result,
        createdAt: new Date(),
      });

      // DAR-78: PersonaAnalysis 테이블에도 영속 — DAR-72 P-C 융합 엔진의 personaViews 입력 소스.
      await this.repo.savePersonaViews(rcpNo, result);

      await this.logTaskUsage(rcpNo, 'persona-interpretation', level, usage);

      return result;
    } finally {
      reservation.settle();
    }
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

    const reservation = await this.resolveLevel(req.gate);
    const level = reservation.level;
    try {
      if (level !== AiCostLevel.L3) {
        this.logger.debug(`[AiAnalyst] rcpNo=${rcpNo} ${level} — position-thesis 스킵(L3 전용)`);
        // DAR-239: 진입 게이트(runSummary)에서만 게이트 결정을 기록한다(분모 왜곡 방지). 여기선 기록하지 않는다.
        return null;
      }

      const { result, usage } = await this.runTask(rcpNo, 'position-thesis', level, () =>
        this.positionThesisTask.run(req.input),
      );

      await this.repo.saveAnalysis({
        rcpNo,
        task: 'position-thesis',
        level,
        resultJson: result,
        createdAt: new Date(),
      });

      await this.logTaskUsage(rcpNo, 'position-thesis', level, usage);

      return result;
    } finally {
      reservation.settle();
    }
  }
}
