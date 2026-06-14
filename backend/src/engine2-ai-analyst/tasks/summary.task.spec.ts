import { SummaryTask, SummaryTaskInput } from './summary.task';
import { LlmClient, LlmResult } from '../llm/llm-client';
import { JsonOutputValidationError } from '../validation/json-output.validator';
import { TaskParseFailureError } from '../types/ai-analyst.types';

const input: SummaryTaskInput = {
  rcpNo: 'R001',
  eventType: 'SUPPLY_CONTRACT',
  keyMetrics: { amount: 1000 },
  excerpt: '단일판매·공급계약 체결 ...',
};

function llmReturning(text: string): LlmClient {
  const res: LlmResult = { text, model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50 };
  return { complete: jest.fn().mockResolvedValue(res) } as unknown as LlmClient;
}

describe('SummaryTask.run', () => {
  it('유효한 JSON 응답을 검증된 draft + usage로 반환', async () => {
    const llm = llmReturning(
      JSON.stringify({
        summary: '대형 공급계약',
        positiveFactors: ['매출 증가'],
        negativeFactors: [],
        polarity: 'POSITIVE',
        garbage: '버려짐',
      }),
    );
    const task = new SummaryTask(llm);
    const { result, usage } = await task.run(input);
    expect(result.polarity).toBe('POSITIVE');
    expect((result as unknown as Record<string, unknown>).garbage).toBeUndefined(); // 화이트리스트
    expect(usage.inputTokens).toBe(100);
  });

  it('잘못된 JSON 응답이면 usage 보존 예외(DAR-240) — 토큰 비용 누락 방지', async () => {
    const task = new SummaryTask(llmReturning('이것은 JSON이 아님'));
    const err = await task.run(input).catch((e) => e);
    expect(err).toBeInstanceOf(TaskParseFailureError);
    expect(err.usage).toEqual({ model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50 });
    expect(err.parseCause).toBeInstanceOf(JsonOutputValidationError);
  });
});
