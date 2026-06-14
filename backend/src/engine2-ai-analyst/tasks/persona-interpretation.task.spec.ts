import { PersonaInterpretationTask, PersonaInterpretationInput } from './persona-interpretation.task';
import { LlmClient, LlmResult } from '../llm/llm-client';
import { JsonOutputValidationError } from '../validation/json-output.validator';
import { TaskParseFailureError } from '../types/ai-analyst.types';

const input: PersonaInterpretationInput = {
  rcpNo: 'R001',
  summary: {
    summary: '대형 공급계약 체결',
    positiveFactors: ['매출 증가 기대'],
    negativeFactors: [],
    polarity: 'POSITIVE',
  },
  personas: ['CONSERVATIVE', 'AGGRESSIVE'],
};

function llmReturning(text: string): LlmClient {
  const res: LlmResult = { text, model: 'gpt-4o-mini', inputTokens: 150, outputTokens: 80 };
  return { complete: jest.fn().mockResolvedValue(res) } as unknown as LlmClient;
}

describe('PersonaInterpretationTask.run', () => {
  it('직접 JSON 배열 응답을 검증된 draft 배열 + usage로 반환', async () => {
    const llm = llmReturning(
      JSON.stringify([
        { persona: 'CONSERVATIVE', interpretation: '보수적 관망 권고', fitScore: 40, garbage: '버려짐' },
        { persona: 'AGGRESSIVE', interpretation: '매수 적극 검토', fitScore: 85 },
      ]),
    );
    const task = new PersonaInterpretationTask(llm);
    const { result, usage } = await task.run(input);
    expect(result).toHaveLength(2);
    expect(result[0].persona).toBe('CONSERVATIVE');
    expect(result[1].fitScore).toBe(85);
    expect((result[0] as unknown as Record<string, unknown>).garbage).toBeUndefined();
    expect(usage.inputTokens).toBe(150);
  });

  it('래퍼 객체 { personas: [...] } 응답도 정상 파싱 (OpenAI json_object 모드 호환)', async () => {
    const llm = llmReturning(
      JSON.stringify({
        personas: [
          { persona: 'CONSERVATIVE', interpretation: '관망', fitScore: 40 },
          { persona: 'AGGRESSIVE', interpretation: '매수', fitScore: 80 },
        ],
      }),
    );
    const task = new PersonaInterpretationTask(llm);
    const { result } = await task.run(input);
    expect(result).toHaveLength(2);
    expect(result[0].persona).toBe('CONSERVATIVE');
  });

  it('잘못된 JSON 응답이면 usage 보존 예외(DAR-240) — 토큰 비용 누락 방지', async () => {
    const task = new PersonaInterpretationTask(llmReturning('이것은 JSON이 아님'));
    const err = await task.run(input).catch((e) => e);
    expect(err).toBeInstanceOf(TaskParseFailureError);
    expect(err.usage).toEqual({ model: 'gpt-4o-mini', inputTokens: 150, outputTokens: 80 });
    expect(err.parseCause).toBeInstanceOf(JsonOutputValidationError);
  });

  it('배열 추출 불가 JSON 응답이면 usage 보존 예외(DAR-240)', async () => {
    const task = new PersonaInterpretationTask(llmReturning('{"persona":"CONSERVATIVE"}'));
    const err = await task.run(input).catch((e) => e);
    expect(err).toBeInstanceOf(TaskParseFailureError);
    expect(err.usage).toEqual({ model: 'gpt-4o-mini', inputTokens: 150, outputTokens: 80 });
    expect(err.parseCause).toBeInstanceOf(JsonOutputValidationError);
  });
});
