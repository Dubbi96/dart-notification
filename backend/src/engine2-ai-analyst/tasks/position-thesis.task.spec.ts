import { PositionThesisTask, PositionThesisInput } from './position-thesis.task';
import { LlmClient, LlmResult } from '../llm/llm-client';
import { JsonOutputValidationError } from '../validation/json-output.validator';

const input: PositionThesisInput = {
  rcpNo: 'R001',
  signalId: 'S001',
  summary: {
    summary: '대형 공급계약 체결',
    positiveFactors: ['매출 증가'],
    negativeFactors: [],
    polarity: 'POSITIVE',
  },
  personaViews: [
    { persona: 'AGGRESSIVE', interpretation: '매수 적극 검토', fitScore: 85 },
  ],
  buyScore: 82,
  chartSummary: '20일 이평선 상향 돌파',
};

function llmReturning(text: string): LlmClient {
  const res: LlmResult = { text, model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100 };
  return { complete: jest.fn().mockResolvedValue(res) } as unknown as LlmClient;
}

describe('PositionThesisTask.run', () => {
  it('유효한 JSON 응답을 검증된 draft + usage로 반환', async () => {
    const llm = llmReturning(
      JSON.stringify({
        initialThesis: '대형 계약 + 기술적 상승 — 단기 모멘텀 진입 논리 성립',
        invalidConditions: ['계약 해지 공시', '분기 매출 감소'],
        riskNotes: '단기 과열 주의',
        garbage: '버려짐',
      }),
    );
    const task = new PositionThesisTask(llm);
    const { result, usage } = await task.run(input);
    expect(result.initialThesis).toBe('대형 계약 + 기술적 상승 — 단기 모멘텀 진입 논리 성립');
    expect(result.invalidConditions).toHaveLength(2);
    expect(result.riskNotes).toBe('단기 과열 주의');
    expect((result as unknown as Record<string, unknown>).garbage).toBeUndefined();
    expect(usage.inputTokens).toBe(200);
  });

  it('잘못된 JSON 응답이면 검증 예외', async () => {
    const task = new PositionThesisTask(llmReturning('이것은 JSON이 아님'));
    await expect(task.run(input)).rejects.toBeInstanceOf(JsonOutputValidationError);
  });

  it('invalidConditions가 객체 배열이면 string[]로 정규화', async () => {
    const llm = llmReturning(
      JSON.stringify({
        initialThesis: '진입 논리',
        invalidConditions: [
          { condition: '계약 해지 공시' },
          { text: '분기 매출 감소' },
          { description: '주가 급락 -10%' },
        ],
        riskNotes: '주의',
      }),
    );
    const task = new PositionThesisTask(llm);
    const { result } = await task.run(input);
    expect(result.invalidConditions).toEqual(['계약 해지 공시', '분기 매출 감소', '주가 급락 -10%']);
  });

  it('invalidConditions가 단일 문자열이면 단일 원소 배열로 정규화', async () => {
    const llm = llmReturning(
      JSON.stringify({
        initialThesis: '진입 논리',
        invalidConditions: '계약 해지 공시',
        riskNotes: '주의',
      }),
    );
    const task = new PositionThesisTask(llm);
    const { result } = await task.run(input);
    expect(result.invalidConditions).toEqual(['계약 해지 공시']);
  });

  it('invalidConditions가 null이면 빈 배열로 정규화', async () => {
    const llm = llmReturning(
      JSON.stringify({
        initialThesis: '진입 논리',
        invalidConditions: null,
        riskNotes: '주의',
      }),
    );
    const task = new PositionThesisTask(llm);
    const { result } = await task.run(input);
    expect(result.invalidConditions).toEqual([]);
  });

  it('invalidConditions 배열에 비문자열 원소가 섞여 있으면 string으로 변환', async () => {
    const llm = llmReturning(
      JSON.stringify({
        initialThesis: '진입 논리',
        invalidConditions: ['계약 해지', 42, true, { label: '급락' }],
        riskNotes: '주의',
      }),
    );
    const task = new PositionThesisTask(llm);
    const { result } = await task.run(input);
    expect(result.invalidConditions).toHaveLength(4);
    expect(result.invalidConditions[0]).toBe('계약 해지');
    expect(result.invalidConditions[1]).toBe('42');
    expect(result.invalidConditions[2]).toBe('true');
  });
});
