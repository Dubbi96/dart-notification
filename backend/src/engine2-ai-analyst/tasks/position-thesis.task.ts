import { Injectable } from '@nestjs/common';
import { TaskRunResult, TaskParseFailureError } from '../types/ai-analyst.types';
import { LlmClient } from '../llm/llm-client';
import { OutputSchema, parseAndValidate } from '../validation/json-output.validator';
import { DisclosureSummaryDraft } from './summary.task';
import { PersonaAnalysisDraft } from './persona-interpretation.task';
import { EARNINGS_BASIS_GUIDE } from './earnings-basis.constant';

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
  '추측·과장 금지. 반드시 JSON만 출력한다. ' +
  // W9: 실적 판정 기준(전년동기 대비/자사 전망) 명시 — 시장 기대치 대비로 오인 금지
  EARNINGS_BASIS_GUIDE;

const OUTPUT_SCHEMA: OutputSchema = {
  initialThesis: { type: 'string' },
  invalidConditions: { type: 'string[]' },
  riskNotes: { type: 'string' },
};

/**
 * LLM 응답 필드를 계약 타입으로 정규화한다.
 * - initialThesis·riskNotes: string — 배열이면 join, 객체면 stringify
 * - invalidConditions: string[] — 객체 배열·단일 문자열·null 등 모두 string[]로 변환
 */
function coerceStringFields(raw: string): string {
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

    for (const field of ['initialThesis', 'riskNotes'] as const) {
      const val = obj[field];
      if (val === null || val === undefined) {
        obj[field] = '';
      } else if (Array.isArray(val)) {
        obj[field] = val.map((v) => (typeof v === 'string' ? v : String(v))).join(' ');
      } else if (typeof val === 'object') {
        obj[field] = JSON.stringify(val);
      } else if (typeof val !== 'string') {
        obj[field] = String(val);
      }
    }

    // invalidConditions를 반드시 string[]로 정규화
    const ic = obj['invalidConditions'];
    if (ic === null || ic === undefined) {
      obj['invalidConditions'] = [];
    } else if (typeof ic === 'string') {
      obj['invalidConditions'] = ic.trim() ? [ic.trim()] : [];
    } else if (Array.isArray(ic)) {
      obj['invalidConditions'] = ic
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item === null || item === undefined) return '';
          if (typeof item === 'object') {
            const o = item as Record<string, unknown>;
            for (const k of ['condition', 'text', 'description', 'value', 'item']) {
              if (typeof o[k] === 'string') return o[k] as string;
            }
            return JSON.stringify(o);
          }
          return String(item);
        })
        .filter((s) => s.length > 0);
    } else if (typeof ic === 'object') {
      obj['invalidConditions'] = Object.values(ic as Record<string, unknown>)
        .map((v) => (typeof v === 'string' ? v : String(v)))
        .filter((s) => s.length > 0);
    } else {
      obj['invalidConditions'] = [String(ic)];
    }

    return JSON.stringify(obj);
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
      '위 정보만으로 포지션 초안 JSON을 출력하라. ' +
        'invalidConditions는 기계가 평가 가능한 조건을 평문 문자열 배열로 나열한다(객체 금지). ' +
        '스키마: { "initialThesis": "string", "invalidConditions": ["string", ...], "riskNotes": "string" }',
    ]
      .filter(Boolean)
      .join('\n');

    const res = await this.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonMode: true,
      maxOutputTokens: 600,
    });

    // 토큰은 이미 청구됨 — 파싱 실패 시에도 usage를 보존해 비용 누락을 막는다(DAR-240).
    const usage = { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
    let result: PositionThesisDraft;
    try {
      result = parseAndValidate<PositionThesisDraft>(coerceStringFields(res.text), OUTPUT_SCHEMA);
    } catch (err) {
      throw new TaskParseFailureError(usage, err);
    }
    return { result, usage };
  }
}
