import { PriceMoveReasoningTask, PriceMoveReasoningInput } from './price-move-reasoning.task';
import { LlmClient, LlmResult } from '../llm/llm-client';
import { JsonOutputValidationError } from '../validation/json-output.validator';
import { TaskParseFailureError } from '../types/ai-analyst.types';

function llmReturning(text: string): { llm: LlmClient; complete: jest.Mock } {
  const res: LlmResult = { text, model: 'gpt-4o-mini', inputTokens: 120, outputTokens: 60 };
  const complete = jest.fn().mockResolvedValue(res);
  return { llm: { complete } as unknown as LlmClient, complete };
}

const baseInput: PriceMoveReasoningInput = {
  rcpNo: '20260717000001',
  corpName: '테스트전자',
  changePct: 6.3,
  direction: 'UP',
  eventType: 'SUPPLY_CONTRACT',
  disclosureTitle: '단일판매·공급계약체결',
  excerpt: '당사는 대규모 공급계약을 체결하였습니다.',
  reactionStats: {
    eventType: 'SUPPLY_CONTRACT',
    sampleCount: 42,
    d1: { avgReturn: 2.1, avgAbnormalReturn: 1.7, winRate: 0.62 },
    d5: { avgReturn: 3.4, avgAbnormalReturn: 2.9, winRate: 0.58 },
    d20: { avgReturn: 1.2, avgAbnormalReturn: 0.4, winRate: 0.51 },
  },
};

describe('PriceMoveReasoningTask (DAR-522)', () => {
  it('유효 JSON 응답을 검증된 draft + usage로 반환하고 화이트리스트 밖 필드는 버린다', async () => {
    const { llm, complete } = llmReturning(
      JSON.stringify({
        cause: '대규모 공급계약 체결이 매출 기대를 키워 상승을 견인했다.',
        evidence: ['공급계약 공시', '유사공시 D+5 초과수익 +2.9%(n=42)'],
        eventLinkage: 'STRONG',
        caveat: '통계는 과거 평균이며 개별 결과를 보장하지 않는다.',
        // ★AI 금지영역 위장 필드 — 화이트리스트 검증이 제거해야 한다.
        recommendation: '매수',
        targetPrice: 99000,
      }),
    );
    const task = new PriceMoveReasoningTask(llm);
    const { result, usage } = await task.run(baseInput);

    expect(result.eventLinkage).toBe('STRONG');
    expect(result.evidence).toHaveLength(2);
    expect((result as unknown as Record<string, unknown>).recommendation).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).targetPrice).toBeUndefined();
    expect(usage).toEqual({ model: 'gpt-4o-mini', inputTokens: 120, outputTokens: 60 });

    // 프롬프트에 등락 방향·EventStudy 통계·설명층 한정 지시가 포함되는지.
    const { system, user } = complete.mock.calls[0][0];
    expect(user).toContain('+6.3%');
    expect(user).toContain('n=42');
    expect(system).toContain('설명(원인 해석)만');
  });

  it('통계가 없으면(null) 프롬프트에 표본 부족을 명시한다', async () => {
    const { llm, complete } = llmReturning(
      JSON.stringify({ cause: 'c', evidence: [], eventLinkage: 'WEAK', caveat: 'x' }),
    );
    const task = new PriceMoveReasoningTask(llm);
    await task.run({ ...baseInput, reactionStats: null });
    expect(complete.mock.calls[0][0].user).toContain('통계: 없음');
  });

  it('잘못된 JSON이면 usage 보존 예외(TaskParseFailureError)를 던진다', async () => {
    const { llm } = llmReturning('이것은 JSON이 아님');
    const task = new PriceMoveReasoningTask(llm);
    const err = await task.run(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(TaskParseFailureError);
    expect(err.usage).toEqual({ model: 'gpt-4o-mini', inputTokens: 120, outputTokens: 60 });
    expect(err.parseCause).toBeInstanceOf(JsonOutputValidationError);
  });
});
