import { Injectable } from '@nestjs/common';
import { Polarity, TaskRunResult, TaskParseFailureError } from '../types/ai-analyst.types';
import { LlmClient } from '../llm/llm-client';
import { OutputSchema, parseAndValidate } from '../validation/json-output.validator';
import { buildExcerpt, formatKeyMetrics } from '../input/build-minimal-input';
import { EARNINGS_BASIS_GUIDE } from './earnings-basis.constant';

export interface SummaryTaskInput {
  rcpNo: string;
  eventType: string;
  keyMetrics: Record<string, unknown>;
  /** 원문 핵심 단락. buildExcerpt로 절단됨. 원문 전문 금지 */
  excerpt: string;
}

export interface DisclosureSummaryDraft {
  summary: string;
  positiveFactors: string[];
  negativeFactors: string[];
  polarity: Polarity;
}

const SYSTEM_PROMPT =
  '너는 한국 주식 공시 분석가다. 주어진 공시 핵심 정보만으로 투자자가 알아야 할 요약과 긍정/부정 요인, 종합 방향성을 판단한다. ' +
  '추측·과장 금지. 반드시 JSON만 출력한다. ' +
  // W9: 실적 판정 기준(전년동기 대비/자사 전망) 명시 — 시장 기대치 대비로 오인 금지
  EARNINGS_BASIS_GUIDE;

const OUTPUT_SCHEMA: OutputSchema = {
  summary: { type: 'string' },
  positiveFactors: { type: 'string[]' },
  negativeFactors: { type: 'string[]' },
  polarity: { type: 'enum', values: ['POSITIVE', 'NEGATIVE', 'MIXED', 'NEUTRAL'] },
};

/** L2 — 공시 요약·핵심 포인트. 입력 최소화 + JSON 강제 + 화이트리스트 검증. */
@Injectable()
export class SummaryTask {
  constructor(private readonly llm: LlmClient) {}

  async run(input: SummaryTaskInput): Promise<TaskRunResult<DisclosureSummaryDraft>> {
    const user = [
      `[이벤트 유형] ${input.eventType}`,
      `[핵심 수치]\n${formatKeyMetrics(input.keyMetrics)}`,
      `[공시 핵심 단락]\n${buildExcerpt(input.excerpt)}`,
      '',
      '위 정보만으로 다음 JSON을 출력하라: ' +
        '{ "summary": string, "positiveFactors": string[], "negativeFactors": string[], "polarity": "POSITIVE"|"NEGATIVE"|"MIXED"|"NEUTRAL" }',
    ].join('\n');

    const res = await this.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonMode: true,
      maxOutputTokens: 800,
    });

    // 토큰은 이미 청구됨 — 파싱 실패 시에도 usage를 보존해 비용 누락을 막는다(DAR-240).
    const usage = { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
    let result: DisclosureSummaryDraft;
    try {
      result = parseAndValidate<DisclosureSummaryDraft>(res.text, OUTPUT_SCHEMA);
    } catch (err) {
      throw new TaskParseFailureError(usage, err);
    }
    return { result, usage };
  }
}
