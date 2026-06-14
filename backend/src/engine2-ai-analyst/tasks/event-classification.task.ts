import { Injectable } from '@nestjs/common';
import { TaskRunResult, TaskParseFailureError } from '../types/ai-analyst.types';
import { LlmClient } from '../llm/llm-client';
import { OutputSchema, parseAndValidate } from '../validation/json-output.validator';
import { buildExcerpt } from '../input/build-minimal-input';

export interface EventClassificationInput {
  rcpNo: string;
  reportName: string;
  ruleEventType: string; // Engine1 Rule 분류 결과 (1차)
  excerpt: string;
}

export interface EventClassificationDraft {
  eventType: string; // AI 보정 결과
  confidence: number; // 0~1
  changedFromRule: boolean; // Rule 분류와 달라졌는지 (불일치율 모니터링)
}

const SYSTEM_PROMPT =
  '너는 한국 주식 공시 이벤트 분류 전문가다. Engine1 Rule이 1차 분류한 이벤트 타입을 공시 핵심 단락으로 검증·보정한다. ' +
  '추측·과장 금지. 반드시 JSON만 출력한다.';

const EVENT_TYPES = [
  'SUPPLY_CONTRACT',
  'ACQUISITION',
  'CAPITAL_INCREASE',
  'EARNINGS_GUIDANCE',
  'MANAGEMENT_ISSUE',
  'OTHER',
] as const;

const OUTPUT_SCHEMA: OutputSchema = {
  eventType: { type: 'string' },
  confidence: { type: 'number' },
  changedFromRule: { type: 'boolean' },
};

/**
 * L1(보조) — 이벤트 타입 1차 분류는 Engine1의 Rule(정규식·키워드)이 담당하고,
 * 모호한 공시만 이 Task가 보정한다. Rule 대비 불일치율은 회귀 항목(M3 ↩︎ M2).
 */
@Injectable()
export class EventClassificationTask {
  constructor(private readonly llm: LlmClient) {}

  async run(input: EventClassificationInput): Promise<TaskRunResult<EventClassificationDraft>> {
    const user = [
      `[보고서명] ${input.reportName}`,
      `[Rule 분류 결과] ${input.ruleEventType}`,
      `[공시 핵심 단락]\n${buildExcerpt(input.excerpt)}`,
      '',
      `위 정보만으로 다음 JSON을 출력하라. eventType은 ${EVENT_TYPES.join('|')} 중 하나: ` +
        '{ "eventType": string, "confidence": number(0~1), "changedFromRule": boolean }',
    ].join('\n');

    const res = await this.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonMode: true,
      maxOutputTokens: 200,
    });

    // 토큰은 이미 청구됨 — 파싱 실패 시에도 usage를 보존해 비용 누락을 막는다(DAR-240).
    const usage = { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
    let result: EventClassificationDraft;
    try {
      result = parseAndValidate<EventClassificationDraft>(res.text, OUTPUT_SCHEMA);
    } catch (err) {
      throw new TaskParseFailureError(usage, err);
    }
    return { result, usage };
  }
}
