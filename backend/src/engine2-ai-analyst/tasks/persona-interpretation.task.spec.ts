import { PersonaInterpretationTask, PersonaInterpretationInput } from './persona-interpretation.task';
import { LlmClient, LlmResult } from '../llm/llm-client';
import { JsonOutputValidationError } from '../validation/json-output.validator';

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
  it('유효한 JSON 배열 응답을 검증된 draft 배열 + usage로 반환', async () => {
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

  it('잘못된 JSON 응답이면 검증 예외', async () => {
    const task = new PersonaInterpretationTask(llmReturning('이것은 JSON이 아님'));
    await expect(task.run(input)).rejects.toBeInstanceOf(JsonOutputValidationError);
  });

  it('배열이 아닌 JSON 응답이면 검증 예외', async () => {
    const task = new PersonaInterpretationTask(llmReturning('{"persona":"CONSERVATIVE"}'));
    await expect(task.run(input)).rejects.toBeInstanceOf(JsonOutputValidationError);
  });
});
