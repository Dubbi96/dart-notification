import {
  AiAnalystService,
  SummaryRequest,
  EventClassificationRequest,
  PersonaInterpretationRequest,
  PositionThesisRequest,
} from './ai-analyst.service';
import { AiCostGateService } from './cost-gate/ai-cost-gate.service';
import { AiCostLimitGuardService } from './cost-gate/ai-cost-limit-guard.service';
import { AiUsageLogService } from './usage-log/ai-usage-log.service';
import { InMemoryAiAnalysisRepository } from './adapters/in-memory-ai-analysis.repository';
import { AiCostLevel } from './types/ai-analyst.types';
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
  // 기본: 한도 미초과(제안 레벨 그대로 통과). 테스트가 강등을 모사할 때 override.
  enforceLimitMock: jest.Mock = jest.fn(async (lvl: AiCostLevel) => lvl),
) {
  const repo = new InMemoryAiAnalysisRepository();
  const usageLog = new AiUsageLogService(repo);
  const logSpy = jest.spyOn(usageLog, 'logUsage');
  const cacheHitSpy = jest.spyOn(usageLog, 'logCacheHit');
  const summaryTask = { run: summaryRunMock } as unknown as SummaryTask;
  const eventTask = { run: eventRunMock } as unknown as EventClassificationTask;
  const personaTask = { run: personaRunMock } as unknown as PersonaInterpretationTask;
  const thesisTask = { run: thesisRunMock } as unknown as PositionThesisTask;
  const limitGuard = { enforceLimit: enforceLimitMock } as unknown as AiCostLimitGuardService;
  const service = new AiAnalystService(
    new AiCostGateService(),
    limitGuard,
    repo,
    usageLog,
    summaryTask,
    eventTask,
    personaTask,
    thesisTask,
  );
  return { service, repo, logSpy, cacheHitSpy, enforceLimitMock };
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
    const { service, repo, logSpy, cacheHitSpy } = buildService(run);
    const res = await service.runSummary(makeReq());
    expect(res).toEqual(summaryDraft);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await repo.findAnalysis('R001', 'summary')).not.toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].costUsd).toBeGreaterThan(0);
    // DAR-241: 첫 호출은 실호출 — 캐시히트 기록 없음.
    expect(cacheHitSpy).not.toHaveBeenCalled();
  });

  it('멱등: 동일 rcpNo 재요청은 캐시 반환, Task 재호출 안 함', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service } = buildService(run);
    await service.runSummary(makeReq());
    const second = await service.runSummary(makeReq());
    expect(second).toEqual(summaryDraft);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('DAR-241: 캐시히트는 logCacheHit로 관측 기록되고 실호출 비용기록은 안 늘어난다', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service, logSpy, cacheHitSpy } = buildService(run);
    await service.runSummary(makeReq()); // 1회차 = 실호출
    await service.runSummary(makeReq()); // 2회차 = 캐시히트(재처리 모사)
    await service.runSummary(makeReq()); // 3회차 = 캐시히트
    // 실호출 1회 → logUsage 1회(비용 분모 불변).
    expect(run).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    // 캐시히트 2회 → logCacheHit 2회. 저장된 레벨(L2)을 동반해 관측된다.
    expect(cacheHitSpy).toHaveBeenCalledTimes(2);
    expect(cacheHitSpy.mock.calls[0][0]).toEqual({
      rcpNo: 'R001',
      task: 'summary',
      level: AiCostLevel.L2,
    });
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

  it('DAR-78: PersonaAnalysis 테이블에도 personaViews를 영속한다(DAR-72 융합 입력 충전)', async () => {
    const run = jest.fn().mockResolvedValue(okResult);
    const { service, repo } = buildService(jest.fn(), jest.fn(), run);
    await service.runPersonaInterpretation(makePersonaReq());
    // PrismaPersonaViewRepository가 읽는 PersonaAnalysis 저장소에 결과가 충전돼야 한다.
    expect(await repo.findPersonaViews('R003')).toEqual(personaDrafts);
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

// ── DAR-78: AiCostLimitGuard 일/월 한도 강제 ─────────────────────────────────

describe('AiAnalystService — AiCostLimitGuard 한도 강제(DAR-78)', () => {
  const summaryOk: TaskRunResult<DisclosureSummaryDraft> = {
    result: summaryDraft,
    usage: { model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 200 },
  };

  it('한도 초과(forced L0) 시 게이트가 L2여도 Summary를 스킵하고 LLM·사용량 기록 0', async () => {
    const run = jest.fn().mockResolvedValue(summaryOk);
    // 한도 초과 → enforceLimit이 어떤 제안 레벨이든 L0으로 강등.
    const forceL0 = jest.fn(async () => AiCostLevel.L0);
    const { service, logSpy } = buildService(run, jest.fn(), jest.fn(), jest.fn(), forceL0);

    const res = await service.runSummary(makeReq()); // 게이트로는 L2 조건
    expect(res).toBeNull();
    expect(run).not.toHaveBeenCalled(); // 유료 LLM 미호출
    expect(logSpy).not.toHaveBeenCalled(); // AIUsageLog 미기록
    expect(forceL0).toHaveBeenCalledWith(AiCostLevel.L2); // 제안 레벨(L2)에 한도 적용
  });

  it('한도 초과 시 Position Thesis(L3 조건)도 강등되어 스킵된다', async () => {
    const run = jest.fn();
    const forceL0 = jest.fn(async () => AiCostLevel.L0);
    const { service } = buildService(jest.fn(), jest.fn(), jest.fn(), run, forceL0);
    const req: PositionThesisRequest = {
      gate: makeGate({ isHolding: true, polarity: 'NEGATIVE' }), // 게이트로는 L3
      input: {
        rcpNo: 'R900',
        signalId: 'S900',
        summary: summaryDraft,
        personaViews: [],
        buyScore: 0,
      },
    };
    const res = await service.runPositionThesis(req);
    expect(res).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(forceL0).toHaveBeenCalledWith(AiCostLevel.L3);
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

// ── DAR-244: 모델 단가표 미매칭 경보 ─────────────────────────────────────────

describe('[DAR-244] AiAnalystService 미등록 모델 단가 경보', () => {
  function summaryReqFor(rcpNo: string): SummaryRequest {
    return {
      gate: makeGate(),
      input: { rcpNo, eventType: 'SUPPLY_CONTRACT', keyMetrics: { amount: 100 }, excerpt: '본문' },
    };
  }
  const resultFor = (model: string): TaskRunResult<DisclosureSummaryDraft> => ({
    result: summaryDraft,
    usage: { model, inputTokens: 500, outputTokens: 200 },
  });

  it('미등록 모델(o4-mini)이면 비용은 폴백 기록되고 warn 1회 노출', async () => {
    const run = jest.fn().mockResolvedValue(resultFor('o4-mini'));
    const { service, logSpy } = buildService(run);
    const warnSpy = jest.spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

    await service.runSummary(summaryReqFor('R001'));

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].costUsd).toBeGreaterThan(0); // DEFAULT_PRICE 폴백 비용
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('o4-mini');
    expect(warnSpy.mock.calls[0][0]).toContain('DAR-244');
  });

  it('동일 미등록 모델 반복 호출은 모델당 1회만 경보(로그 폭주 방지)', async () => {
    const run = jest.fn().mockResolvedValue(resultFor('o4-mini'));
    const { service } = buildService(run);
    const warnSpy = jest.spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

    await service.runSummary(summaryReqFor('R001'));
    await service.runSummary(summaryReqFor('R002'));

    expect(run).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('등록 모델(gpt-4o-mini)은 경보하지 않음(회귀 보존)', async () => {
    const run = jest.fn().mockResolvedValue(resultFor('gpt-4o-mini'));
    const { service } = buildService(run);
    const warnSpy = jest.spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

    await service.runSummary(summaryReqFor('R001'));

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
