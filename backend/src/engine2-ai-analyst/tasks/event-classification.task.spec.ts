import { EventClassificationTask, EventClassificationInput } from './event-classification.task';
import { LlmClient, LlmResult } from '../llm/llm-client';
import { JsonOutputValidationError } from '../validation/json-output.validator';
import { TaskParseFailureError } from '../types/ai-analyst.types';

const input: EventClassificationInput = {
  rcpNo: 'R001',
  reportName: '단일판매·공급계약 체결',
  ruleEventType: 'SUPPLY_CONTRACT',
  excerpt: '당사는 A사와 단일판매·공급계약을 체결하였습니다...',
};

function llmReturning(text: string): LlmClient {
  const res: LlmResult = { text, model: 'gpt-4o-mini', inputTokens: 80, outputTokens: 30 };
  return { complete: jest.fn().mockResolvedValue(res) } as unknown as LlmClient;
}

describe('EventClassificationTask.run', () => {
  it('유효한 JSON 응답을 검증된 draft + usage로 반환', async () => {
    const llm = llmReturning(
      JSON.stringify({
        eventType: 'SUPPLY_CONTRACT',
        confidence: 0.95,
        changedFromRule: false,
        garbage: '버려짐',
      }),
    );
    const task = new EventClassificationTask(llm);
    const { result, usage } = await task.run(input);
    expect(result.eventType).toBe('SUPPLY_CONTRACT');
    expect(result.confidence).toBe(0.95);
    expect(result.changedFromRule).toBe(false);
    expect((result as unknown as Record<string, unknown>).garbage).toBeUndefined();
    expect(usage.inputTokens).toBe(80);
  });

  it('잘못된 JSON 응답이면 usage 보존 예외(DAR-240) — 토큰 비용 누락 방지', async () => {
    const task = new EventClassificationTask(llmReturning('이것은 JSON이 아님'));
    const err = await task.run(input).catch((e) => e);
    expect(err).toBeInstanceOf(TaskParseFailureError);
    expect(err.usage).toEqual({ model: 'gpt-4o-mini', inputTokens: 80, outputTokens: 30 });
    expect(err.parseCause).toBeInstanceOf(JsonOutputValidationError);
  });
});
