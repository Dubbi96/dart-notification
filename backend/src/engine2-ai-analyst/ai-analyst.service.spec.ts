import { AiAnalystService, SummaryRequest } from './ai-analyst.service';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { InMemoryAiAnalysisRepository } from './adapters/in-memory-ai-analysis.repository';
import { SummaryTask } from './tasks/summary.task';
import { TaskRunResult } from './types/ai-analyst.types';
import type { DisclosureSummaryDraft } from './tasks/summary.task';

function makeReq(over: Partial<SummaryRequest['gate']> = {}): SummaryRequest {
  return {
    gate: {
      isManagementStock: false,
      isTargetEventType: true,
      tradingValue: 5_000_000_000,
      confidence: 0.9,
      ...over,
    },
    input: { rcpNo: 'R001', eventType: 'SUPPLY_CONTRACT', keyMetrics: { amount: 100 }, excerpt: '본문' },
  };
}

const draft: DisclosureSummaryDraft = {
  summary: '요약',
  positiveFactors: ['p'],
  negativeFactors: [],
  polarity: 'POSITIVE',
};

function buildService(runMock: jest.Mock) {
  const repo = new InMemoryAiAnalysisRepository();
  const usageLog = new AiUsageLogService(repo);
  const logSpy = jest.spyOn(usageLog, 'logUsage');
  const summaryTask = { run: runMock } as unknown as SummaryTask;
  const service = new AiAnalystService(new AiCostGateService(), repo, usageLog, summaryTask);
  return { service, repo, logSpy };
}

describe('AiAnalystService.runSummary', () => {
  const okResult: TaskRunResult<DisclosureSummaryDraft> = {
    result: draft,
    usage: { model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 200 },
  };

  it('게이트 L0(관리종목)면 분석을 스킵하고 null, Task 미호출', async () => {
    const run = jest.fn();
    const { service } = buildService(run);
    const res = await service.runSummary(makeReq({ isManagementStock: true }));
    expect(res).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('정상 경로: Task 실행 + 결과 저장 + 사용량(비용) 기록', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service, repo, logSpy } = buildService(run);
    const res = await service.runSummary(makeReq());
    expect(res).toEqual(draft);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await repo.findAnalysis('R001', 'summary')).not.toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].costUsd).toBeGreaterThan(0);
  });

  it('멱등: 동일 rcpNo 재요청은 캐시 반환, Task 재호출 안 함', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service } = buildService(run);
    await service.runSummary(makeReq());
    const second = await service.runSummary(makeReq());
    expect(second).toEqual(draft);
    expect(run).toHaveBeenCalledTimes(1); // 두 번째는 캐시
  });
});
