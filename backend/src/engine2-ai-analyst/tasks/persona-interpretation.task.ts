import { Injectable } from '@nestjs/common';
import { TaskRunResult } from '../types/ai-analyst.types';
import { LlmClient } from '../llm/llm-client';
import { OutputSchema, parseAndValidate, JsonOutputValidationError } from '../validation/json-output.validator';
import { DisclosureSummaryDraft } from './summary.task';

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
  '추측·과장 금지. 반드시 JSON 배열만 출력한다.';

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

/** L2 — Persona 4종 관점별 해석. Summary 산출물을 입력으로 받아 입력 최소화. */
@Injectable()
export class PersonaInterpretationTask {
  constructor(private readonly llm: LlmClient) {}

  async run(input: PersonaInterpretationInput): Promise<TaskRunResult<PersonaAnalysisDraft[]>> {
    const personaList = input.personas.join(', ');
    const user = [
      `[공시 요약]\n${formatSummaryForPrompt(input.summary)}`,
      '',
      `다음 Persona(${personaList}) 각각에 대해 JSON 배열을 출력하라: ` +
        '[{ "persona": "CONSERVATIVE"|"BALANCED"|"AGGRESSIVE"|"EVENT_DRIVEN", "interpretation": string, "fitScore": number(0~100) }, ...]',
    ].join('\n');

    const res = await this.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonMode: true,
      maxOutputTokens: 600,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      throw new JsonOutputValidationError('JSON 파싱 실패');
    }

    if (!Array.isArray(parsed)) {
      throw new JsonOutputValidationError('최상위가 배열이 아님');
    }

    const result: PersonaAnalysisDraft[] = (parsed as unknown[]).map((item) =>
      parseAndValidate<PersonaAnalysisDraft>(JSON.stringify(item), ITEM_SCHEMA),
    );

    return {
      result,
      usage: { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens },
    };
  }
}
