import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { HttpLlmClient } from './http-llm-client';
import { SummaryTask } from '../tasks/summary.task';
import { PersonaInterpretationTask } from '../tasks/persona-interpretation.task';
import { PositionThesisTask } from '../tasks/position-thesis.task';
import { PriceMoveReasoningTask } from '../price-move-reasoning/price-move-reasoning.task';
import { EventClassificationTask } from '../tasks/event-classification.task';
import { HUMANIZER_KO_FIELDS, HUMANIZER_KO_VERSION } from '../tasks/humanizer-ko.prompt';
import { TaskParseFailureError } from '../types/ai-analyst.types';

jest.mock('axios');
const post = axios.post as jest.MockedFunction<typeof axios.post>;
const summary = {
  summary: '테스트전자 2026-10-13 공급계약 1,200억원.',
  positiveFactors: ['계약 1,200억원'],
  negativeFactors: ['대금 회수 시점 미확인'],
  polarity: 'MIXED' as const,
};
const summaryInput = {
  rcpNo: '20261013000001',
  eventType: 'SUPPLY_CONTRACT',
  keyMetrics: { amount: '1,200억원', date: '2026-10-13' },
  excerpt: summary.summary,
};

function client() {
  const values: Record<string, string> = {
    LLM_API_KEY: 'test-only-key',
    LLM_BASE_URL: 'https://test.invalid/v1',
    LLM_MODEL: 'configured-model-unchanged',
  };
  return new HttpLlmClient({ get: (key: string) => values[key] } as ConfigService);
}

function reply(payload: unknown) {
  post.mockResolvedValueOnce({
    data: {
      choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }],
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    },
  });
}

function requestBody() {
  return post.mock.calls[0][1] as {
    messages: Array<{ role: string; content: string }>;
    model: string;
    max_tokens: number;
    response_format: { type: string };
  };
}

beforeEach(() => post.mockReset());

describe('Humanizer Korean prose via existing HTTP request (#585)', () => {
  it('명시적 표시 task 네 개만 대상이며 기계 조건은 편집하지 않는다', () => {
    expect(Object.keys(HUMANIZER_KO_FIELDS)).toEqual([
      'summary', 'persona-interpretation', 'position-thesis', 'price-move-reasoning',
    ]);
    expect(HUMANIZER_KO_FIELDS['position-thesis']).not.toContain('invalidConditions');
  });

  it('요약 API 한 번에 지침을 전달하고 JSON·모델·수치·enum·usage를 그대로 유지한다', async () => {
    reply(summary);
    const output = await new SummaryTask(client()).run(summaryInput);
    expect(post).toHaveBeenCalledTimes(1);
    const [url] = post.mock.calls[0];
    const payload = requestBody();
    expect(url).toBe('https://test.invalid/v1/chat/completions');
    expect(payload).toMatchObject({
      model: 'configured-model-unchanged',
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });
    expect(payload.messages[0]).toMatchObject({ role: 'system' });
    expect(payload.messages[0].content).toContain(HUMANIZER_KO_VERSION);
    expect(payload.messages[0].content).toContain(`적용 필드: ${HUMANIZER_KO_FIELDS.summary}`);
    expect(payload.messages[0].content).toContain('JSON 스키마의 최종 결과만');
    expect(payload.messages[0].content).toContain('Rule·Risk gate·주문 판단을 바꾸지 않는다');
    expect(payload.messages[1].content).toContain('1,200억원');
    expect(output.result).toEqual(summary);
    expect(output.usage).toEqual({ model: 'configured-model-unchanged', inputTokens: 123, outputTokens: 45 });
  });

  it('Persona 문장만 대상이며 fitScore와 persona enum은 응답 그대로 보존한다', async () => {
    const persona = { persona: 'BALANCED' as const, interpretation: '회수 시점을 확인해야 한다.', fitScore: 57.5 };
    reply({ personas: [persona] });
    const output = await new PersonaInterpretationTask(client()).run({
      rcpNo: summaryInput.rcpNo, summary, personas: ['BALANCED'],
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(requestBody().messages[0].content).toContain('적용 필드: personas[].interpretation');
    expect(output.result).toEqual([persona]);
  });

  it('포지션 설명에서도 기계 평가 조건을 후처리하거나 바꾸지 않는다', async () => {
    const thesis = {
      initialThesis: '계약 매출 반영 시점을 확인한다.',
      invalidConditions: ['종가 < 70,000원', '2026-10-13 이후 계약 해지'],
      riskNotes: '회수 시점은 미확인이다.',
    };
    reply(thesis);
    const output = await new PositionThesisTask(client()).run({
      rcpNo: summaryInput.rcpNo, signalId: 'signal-585', summary, personaViews: [], buyScore: 80,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(requestBody().messages[0].content).toContain('적용 필드: initialThesis, riskNotes');
    expect(output.result).toEqual(thesis);
  });

  it('급등락 설명은 근거·한계를 유지하고 주문/목표가 필드를 계속 제거한다', async () => {
    const explanation = {
      cause: '공시와 가격 변동의 인과관계는 확인되지 않았다.',
      evidence: ['테스트전자 2026-10-13 공급계약 1,200억원'],
      eventLinkage: 'UNCLEAR',
      caveat: '유사 사례의 표본이 부족하다.',
    };
    reply({ ...explanation, targetPrice: 100000, order: 'BUY' });
    const output = await new PriceMoveReasoningTask(client()).run({
      rcpNo: summaryInput.rcpNo, corpName: '테스트전자', changePct: 6.3, direction: 'UP',
      eventType: 'SUPPLY_CONTRACT', disclosureTitle: '공급계약', excerpt: summary.summary, reactionStats: null,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(requestBody().messages[0].content).toContain('적용 필드: cause, evidence[], caveat');
    expect(requestBody().messages[0].content).toContain('설명(원인 해석)만');
    expect(output.result).toEqual(explanation);
  });

  it('분류 task에는 문체 지침을 넣지 않는다', async () => {
    const classification = { eventType: 'SUPPLY_CONTRACT', confidence: 0.75, changedFromRule: false };
    reply(classification);
    const output = await new EventClassificationTask(client()).run({
      rcpNo: summaryInput.rcpNo, reportName: '공급계약', ruleEventType: 'SUPPLY_CONTRACT', excerpt: summary.summary,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(requestBody().messages[0].content).not.toContain(HUMANIZER_KO_VERSION);
    expect(output.result).toEqual(classification);
  });

  it('문체 지침이 있어도 스키마 위반은 기존 usage 보존 오류로 거부하고 재호출하지 않는다', async () => {
    reply({ ...summary, polarity: 'BUY_NOW' });
    await expect(new SummaryTask(client()).run(summaryInput)).rejects.toBeInstanceOf(TaskParseFailureError);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
