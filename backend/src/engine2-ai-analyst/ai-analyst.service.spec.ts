import {
  AiAnalystService,
  SummaryRequest,
  EventClassificationRequest,
  PersonaInterpretationRequest,
  PositionThesisRequest,
} from './ai-analyst.service';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { InMemoryAiAnalysisRepository } from './adapters/in-memory-ai-analysis.repository';
import { SummaryTask } from './tasks/summary.task';
import { EventClassificationTask } from './tasks/event-classification.task';
import { PersonaInterpretationTask } from './tasks/persona-interpretation.task';
import { PositionThesisTask } from './tasks/position-thesis.task';
import { TaskRunResult } from './types/ai-analyst.types';
import type { DisclosureSummaryDraft } from './tasks/summary.task';
import type { EventClassificationDraft } from './tasks/event-classification.task';
import type { PersonaAnalysisDraft } from './tasks/persona-interpretation.task';
import type { PositionThesisDraft } from './tasks/position-thesis.task';

function makeGate(over: Partial<SummaryRequest['gate']> = {}): SummaryRequest['gate'] {
  return {
    isManagementStock: false,
    isTargetEventType: true,
    tradingValue: 5_000_000_000,
    confidence: 0.9,
    ...over,
  };
}

function makeReq(over: Partial<SummaryRequest['gate']> = {}): SummaryRequest {
  return {
    gate: makeGate(over),
    input: { rcpNo: 'R001', eventType: 'SUPPLY_CONTRACT', keyMetrics: { amount: 100 }, excerpt: '본문' },
  };
}

const summaryDraft: DisclosureSummaryDraft = {
  summary: '요약',
  positiveFactors: ['p'],
  negativeFactors: [],
  polarity: 'POSITIVE',
};

function buildService(
  summaryRunMock: jest.Mock,
  eventRunMock: jest.Mock = jest.fn(),
  personaRunMock: jest.Mock = jest.fn(),
  thesisRunMock: jest.Mock = jest.fn(),
) {
  const repo = new InMemoryAiAnalysisRepository();
  const usageLog = new AiUsageLogService(repo);
  const logSpy = jest.spyOn(usageLog, 'logUsage');
  const summaryTask = { run: summaryRunMock } as unknown as SummaryTask;
  const eventTask = { run: eventRunMock } as unknown as EventClassificationTask;
  const personaTask = { run: personaRunMock } as unknown as PersonaInterpretationTask;
  const thesisTask = { run: thesisRunMock } as unknown as PositionThesisTask;
  const service = new AiAnalystService(
    new AiCostGateService(),
    repo,
    usageLog,
    summaryTask,
    eventTask,
    personaTask,
    thesisTask,
  );
  return { service, repo, logSpy };
}

// ── runSummary ──────────────────────────────────────────────────────────────

describe('AiAnalystService.runSummary', () => {
  const okResult: TaskRunResult<DisclosureSummaryDraft> = {
    result: summaryDraft,
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
    expect(res).toEqual(summaryDraft);
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
    expect(second).toEqual(summaryDraft);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ── runEventClassification ──────────────────────────────────────────────────

describe('AiAnalystService.runEventClassification', () => {
  const ecDraft: EventClassificationDraft = {
    eventType: 'SUPPLY_CONTRACT',
    confidence: 0.95,
    changedFromRule: false,
  };
  const okResult: TaskRunResult<EventClassificationDraft> = {
    result: ecDraft,
    usage: { model: 'gpt-4o-mini', inputTokens: 80, outputTokens: 30 },
  };

  function makeEcReq(over: Partial<SummaryRequest['gate']> = {}): EventClassificationRequest {
    return {
      gate: makeGate(over),
      input: { rcpNo: 'R002', reportName: '단일판매·공급계약 체결', ruleEventType: 'SUPPLY_CONTRACT', excerpt: '본문' },
    };
  }

  it('게이트 L0이면 스킵하고 null', async () => {
    const run = jest.fn();
    const { service } = buildService(jest.fn(), run);
    const res = await service.runEventClassification(makeEcReq({ isManagementStock: true }));
    expect(res).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('정상 경로: Task 실행 + 결과 저장 + 사용량 기록', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service, repo, logSpy } = buildService(jest.fn(), run);
    const res = await service.runEventClassification(makeEcReq());
    expect(res).toEqual(ecDraft);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await repo.findAnalysis('R002', 'event-classification')).not.toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('멱등: 동일 rcpNo 재요청은 캐시 반환', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service } = buildService(jest.fn(), run);
    await service.runEventClassification(makeEcReq());
    const second = await service.runEventClassification(makeEcReq());
    expect(second).toEqual(ecDraft);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ── runPersonaInterpretation ────────────────────────────────────────────────

describe('AiAnalystService.runPersonaInterpretation', () => {
  const personaDrafts: PersonaAnalysisDraft[] = [
    { persona: 'CONSERVATIVE', interpretation: '보수적 관망', fitScore: 40 },
    { persona: 'AGGRESSIVE', interpretation: '적극 매수 검토', fitScore: 85 },
  ];
  const okResult: TaskRunResult<PersonaAnalysisDraft[]> = {
    result: personaDrafts,
    usage: { model: 'gpt-4o-mini', inputTokens: 150, outputTokens: 80 },
  };

  function makePersonaReq(over: Partial<SummaryRequest['gate']> = {}): PersonaInterpretationRequest {
    return {
      gate: makeGate(over),
      input: {
        rcpNo: 'R003',
        summary: summaryDraft,
        personas: ['CONSERVATIVE', 'AGGRESSIVE'],
      },
    };
  }

  it('게이트 L0/L1이면 스킵하고 null', async () => {
    const run = jest.fn();
    const { service } = buildService(jest.fn(), jest.fn(), run);
    const res = await service.runPersonaInterpretation(makePersonaReq({ isManagementStock: true }));
    expect(res).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('정상 경로: Task 실행 + 결과 저장 + 사용량 기록', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service, repo, logSpy } = buildService(jest.fn(), jest.fn(), run);
    const res = await service.runPersonaInterpretation(makePersonaReq());
    expect(res).toEqual(personaDrafts);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await repo.findAnalysis('R003', 'persona-interpretation')).not.toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('멱등: 동일 rcpNo 재요청은 캐시 반환', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service } = buildService(jest.fn(), jest.fn(), run);
    await service.runPersonaInterpretation(makePersonaReq());
    const second = await service.runPersonaInterpretation(makePersonaReq());
    expect(second).toEqual(personaDrafts);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ── runPositionThesis ───────────────────────────────────────────────────────

describe('AiAnalystService.runPositionThesis', () => {
  const thesisDraft: PositionThesisDraft = {
    initialThesis: '진입 논리',
    invalidConditions: ['계약 해지'],
    riskNotes: '단기 과열 주의',
  };
  const okResult: TaskRunResult<PositionThesisDraft> = {
    result: thesisDraft,
    usage: { model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100 },
  };

  function makeThesisReq(
    gateOver: Partial<SummaryRequest['gate']> = {},
  ): PositionThesisRequest {
    return {
      gate: makeGate({ buyScore: 85, ...gateOver }),
      input: {
        rcpNo: 'R004',
        signalId: 'S004',
        summary: summaryDraft,
        personaViews: [{ persona: 'AGGRESSIVE', interpretation: '적극 매수', fitScore: 85 }],
        buyScore: 85,
      },
    };
  }

  it('게이트 L3 미만이면 스킵하고 null', async () => {
    const run = jest.fn();
    const { service } = buildService(jest.fn(), jest.fn(), jest.fn(), run);
    // L2 게이트 조건 (buyScore 없음)
    const req: PositionThesisRequest = {
      gate: makeGate(),
      input: {
        rcpNo: 'R004',
        signalId: 'S004',
        summary: summaryDraft,
        personaViews: [],
        buyScore: 50,
      },
    };
    const res = await service.runPositionThesis(req);
    expect(res).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('정상 경로(L3): Task 실행 + 결과 저장 + 사용량 기록', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service, repo, logSpy } = buildService(jest.fn(), jest.fn(), jest.fn(), run);
    const res = await service.runPositionThesis(makeThesisReq());
    expect(res).toEqual(thesisDraft);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await repo.findAnalysis('R004', 'position-thesis')).not.toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('멱등: 동일 rcpNo 재요청은 캐시 반환', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service } = buildService(jest.fn(), jest.fn(), jest.fn(), run);
    await service.runPositionThesis(makeThesisReq());
    const second = await service.runPositionThesis(makeThesisReq());
    expect(second).toEqual(thesisDraft);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
