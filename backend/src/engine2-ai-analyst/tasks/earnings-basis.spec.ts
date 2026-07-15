// backend/src/engine2-ai-analyst/tasks/earnings-basis.spec.ts
// W9 정직 라벨링 — 4개 AI Task system prompt에 실적 판정 기준(전년동기 대비/자사 전망)
// 지시문이 실제로 실려 나가는지 검증한다. (LLM은 mock — 네트워크/비용 0)

import { EARNINGS_BASIS_GUIDE } from './earnings-basis.constant';
import { SummaryTask } from './summary.task';
import { EventClassificationTask } from './event-classification.task';
import { PersonaInterpretationTask } from './persona-interpretation.task';
import { PositionThesisTask } from './position-thesis.task';
import { LlmClient, LlmResult } from '../llm/llm-client';

function llmReturning(text: string): { llm: LlmClient; complete: jest.Mock } {
  const res: LlmResult = { text, model: 'gpt-4o-mini', inputTokens: 10, outputTokens: 10 };
  const complete = jest.fn().mockResolvedValue(res);
  return { llm: { complete } as unknown as LlmClient, complete };
}

function systemOf(complete: jest.Mock): string {
  return (complete.mock.calls[0][0] as { system: string }).system;
}

const summaryDraft = {
  summary: '실적 가이던스 공시',
  positiveFactors: [],
  negativeFactors: [],
  polarity: 'MIXED' as const,
};

describe('EARNINGS_BASIS_GUIDE (W9)', () => {
  it('전년동기(YoY) 대비 기준과 자사 전망을 명시한다', () => {
    expect(EARNINGS_BASIS_GUIDE).toContain('전년동기(YoY) 대비');
    expect(EARNINGS_BASIS_GUIDE).toContain('자사 전망');
  });

  it("'컨센서스' 단어를 쓰지 않는다 (산출 카피 오염 방지)", () => {
    expect(EARNINGS_BASIS_GUIDE).not.toMatch(/컨센서스/);
  });

  it('시장 기대치 대비 서술 금지를 지시한다', () => {
    expect(EARNINGS_BASIS_GUIDE).toContain('시장 기대치');
    expect(EARNINGS_BASIS_GUIDE).toContain('서술하지 마라');
  });
});

describe('4개 Task system prompt에 기준 지시문 포함 (W9)', () => {
  it('SummaryTask', async () => {
    const { llm, complete } = llmReturning(
      JSON.stringify({ summary: 's', positiveFactors: [], negativeFactors: [], polarity: 'MIXED' }),
    );
    await new SummaryTask(llm).run({
      rcpNo: 'R001',
      eventType: 'EARNINGS_SURPRISE',
      keyMetrics: {},
      excerpt: '실적 공시',
    });
    expect(systemOf(complete)).toContain(EARNINGS_BASIS_GUIDE);
  });

  it('EventClassificationTask', async () => {
    const { llm, complete } = llmReturning(
      JSON.stringify({ eventType: 'EARNINGS_GUIDANCE', confidence: 0.9, changedFromRule: false }),
    );
    await new EventClassificationTask(llm).run({
      rcpNo: 'R001',
      reportName: '연결재무제표기준영업실적등에대한전망(공정공시)',
      ruleEventType: 'EARNINGS_GUIDANCE',
      excerpt: '전망 공시',
    });
    expect(systemOf(complete)).toContain(EARNINGS_BASIS_GUIDE);
  });

  it('PersonaInterpretationTask', async () => {
    const { llm, complete } = llmReturning(
      JSON.stringify({
        personas: [{ persona: 'BALANCED', interpretation: 'i', fitScore: 50 }],
      }),
    );
    await new PersonaInterpretationTask(llm).run({
      rcpNo: 'R001',
      summary: summaryDraft,
      personas: ['BALANCED'],
    });
    expect(systemOf(complete)).toContain(EARNINGS_BASIS_GUIDE);
  });

  it('PositionThesisTask', async () => {
    const { llm, complete } = llmReturning(
      JSON.stringify({ initialThesis: 't', invalidConditions: [], riskNotes: 'r' }),
    );
    await new PositionThesisTask(llm).run({
      rcpNo: 'R001',
      signalId: 'S001',
      summary: summaryDraft,
      personaViews: [],
      buyScore: 70,
    });
    expect(systemOf(complete)).toContain(EARNINGS_BASIS_GUIDE);
  });
});
