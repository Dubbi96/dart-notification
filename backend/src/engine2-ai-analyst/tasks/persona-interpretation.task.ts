import { Injectable } from '@nestjs/common';
import { TaskRunResult, TaskParseFailureError } from '../types/ai-analyst.types';
import { LlmClient } from '../llm/llm-client';
import { OutputSchema, parseAndValidateArray, JsonOutputValidationError } from '../validation/json-output.validator';
import { DisclosureSummaryDraft } from './summary.task';
import { EARNINGS_BASIS_GUIDE } from './earnings-basis.constant';

export type PersonaType = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'EVENT_DRIVEN';

export interface PersonaInterpretationInput {
  rcpNo: string;
  summary: DisclosureSummaryDraft; // Summary Task 산출물을 입력으로 (원문 재투입 금지)
  personas: PersonaType[];
}

export interface PersonaAnalysisDraft {
  persona: PersonaType;
  interpretation: string;
  fitScore: number; // 0~100 — Persona 적합도
}

const SYSTEM_PROMPT =
  '너는 한국 주식 투자자 Persona 해석 전문가다. 공시 요약을 투자 성향별로 해석한다. ' +
  '추측·과장 금지. 반드시 JSON 객체로 출력한다. ' +
  // W9: 실적 판정 기준(전년동기 대비/자사 전망) 명시 — 시장 기대치 대비로 오인 금지
  EARNINGS_BASIS_GUIDE;

const ITEM_SCHEMA: OutputSchema = {
  persona: { type: 'enum', values: ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE', 'EVENT_DRIVEN'] },
  interpretation: { type: 'string' },
  fitScore: { type: 'number' },
};

function formatSummaryForPrompt(s: DisclosureSummaryDraft): string {
  return [
    `요약: ${s.summary}`,
    `긍정요인: ${s.positiveFactors.join(', ') || '없음'}`,
    `부정요인: ${s.negativeFactors.join(', ') || '없음'}`,
    `방향성: ${s.polarity}`,
  ].join('\n');
}

/**
 * OpenAI json_object 모드는 최상위 배열 반환 불가.
 * 래퍼 객체 { "personas": [...] }로 요청하고, 파싱 후 배열을 추출한다.
 */
function parsePersonaArray(raw: string): PersonaAnalysisDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JsonOutputValidationError('JSON 파싱 실패');
  }
  // 직접 배열 반환 (비-json_object 모드 또는 일부 모델)
  if (Array.isArray(parsed)) {
    return parseAndValidateArray<PersonaAnalysisDraft>(raw, ITEM_SCHEMA);
  }
  // 래퍼 객체 { "personas": [...] } 또는 유사 형태
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const arrayValue = obj['personas'] ?? obj['items'] ?? obj['results'] ?? Object.values(obj)[0];
    if (Array.isArray(arrayValue)) {
      return parseAndValidateArray<PersonaAnalysisDraft>(JSON.stringify(arrayValue), ITEM_SCHEMA);
    }
  }
  throw new JsonOutputValidationError('최상위가 배열이 아님');
}

/** L2 — Persona 4종 관점별 해석. Summary 산출물을 입력으로 받아 입력 최소화. */
@Injectable()
export class PersonaInterpretationTask {
  constructor(private readonly llm: LlmClient) {}

  async run(input: PersonaInterpretationInput): Promise<TaskRunResult<PersonaAnalysisDraft[]>> {
    const personaList = input.personas.join(', ');
    const user = [
      `[공시 요약]\n${formatSummaryForPrompt(input.summary)}`,
      '',
      `다음 Persona(${personaList}) 각각에 대해 다음 JSON 형식으로 출력하라: ` +
        '{ "personas": [{ "persona": "CONSERVATIVE"|"BALANCED"|"AGGRESSIVE"|"EVENT_DRIVEN", "interpretation": string, "fitScore": number(0~100) }, ...] }',
    ].join('\n');

    const res = await this.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonMode: true,
      maxOutputTokens: 600,
    });

    // 토큰은 이미 청구됨 — 파싱 실패 시에도 usage를 보존해 비용 누락을 막는다(DAR-240).
    const usage = { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
    let result: PersonaAnalysisDraft[];
    try {
      result = parsePersonaArray(res.text);
    } catch (err) {
      throw new TaskParseFailureError(usage, err);
    }

    return { result, usage };
  }
}
