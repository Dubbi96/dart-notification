import { Injectable } from '@nestjs/common';
import { TaskRunResult } from '../types/ai-analyst.types';
import { LlmClient } from '../llm/llm-client';
import { OutputSchema, parseAndValidate } from '../validation/json-output.validator';
import { DisclosureSummaryDraft } from './summary.task';
import { PersonaAnalysisDraft } from './persona-interpretation.task';

export interface PositionThesisInput {
  rcpNo: string;
  signalId: string;
  summary: DisclosureSummaryDraft;
  personaViews: PersonaAnalysisDraft[];
  buyScore: number; // M6 산출물
  chartSummary?: string; // M4 지표 요약
}

export interface PositionThesisDraft {
  initialThesis: string; // 진입 논리
  invalidConditions: string[]; // 기계 평가 가능한 훼손 조건 (M7에서 검증)
  riskNotes: string;
}

const SYSTEM_PROMPT =
  '너는 한국 주식 공시 기반 포지션 초안 작성 전문가다. ' +
  '이 결과는 참고 정보일 뿐이며 최종 매수/주문 결정은 별도 시스템이 내린다. ' +
  '추측·과장 금지. 반드시 JSON만 출력한다.';

const OUTPUT_SCHEMA: OutputSchema = {
  initialThesis: { type: 'string' },
  invalidConditions: { type: 'string[]' },
  riskNotes: { type: 'string' },
};

/**
 * LLM이 riskNotes를 배열로 반환하는 경우를 처리한다.
 * JSON 파싱 후 riskNotes가 배열이면 문자열로 결합 (필드 계약은 string 유지).
 */
function coerceRiskNotes(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw; // parseAndValidate가 처리
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed)
  ) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['riskNotes'])) {
      obj['riskNotes'] = (obj['riskNotes'] as string[]).join('. ');
      return JSON.stringify(obj);
    }
  }
  return raw;
}

function formatPersonaViews(views: PersonaAnalysisDraft[]): string {
  return views
    .map((v) => `- ${v.persona}(적합도 ${v.fitScore}): ${v.interpretation}`)
    .join('\n');
}

/**
 * L3 — 실제 매수 후보(buyScore 높음)에만 실행하는 최고비용 Task.
 * 출력은 Engine4 PositionThesis 의 초안일 뿐, 최종 매수/주문 결정은 AI가 하지 않는다(금지영역).
 */
@Injectable()
export class PositionThesisTask {
  constructor(private readonly llm: LlmClient) {}

  async run(input: PositionThesisInput): Promise<TaskRunResult<PositionThesisDraft>> {
    const user = [
      `[신호 ID] ${input.signalId}  [Buy Score] ${input.buyScore}`,
      `[공시 요약] ${input.summary.summary}  [방향성] ${input.summary.polarity}`,
      input.chartSummary ? `[차트 요약] ${input.chartSummary}` : '',
      `[Persona 해석]\n${formatPersonaViews(input.personaViews)}`,
      '',
      '위 정보만으로 포지션 초안 JSON을 출력하라. invalidConditions는 기계가 평가 가능한 조건 목록: ' +
        '{ "initialThesis": string, "invalidConditions": string[], "riskNotes": string }',
    ]
      .filter(Boolean)
      .join('\n');

    const res = await this.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonMode: true,
      maxOutputTokens: 600,
    });

    const result = parseAndValidate<PositionThesisDraft>(coerceRiskNotes(res.text), OUTPUT_SCHEMA);
    return {
      result,
      usage: { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens },
    };
  }
}
