import { Injectable, Logger } from '@nestjs/common';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { AiAnalysisRepository } from './ports/ai-analysis.repository';
import { SummaryTask, SummaryTaskInput, DisclosureSummaryDraft } from './tasks/summary.task';
import { estimateCostUsd } from './pricing/estimate-cost';
import { AiCostLevel, AiGateInput } from './types/ai-analyst.types';

export interface SummaryRequest {
  gate: AiGateInput;
  input: SummaryTaskInput;
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
}
