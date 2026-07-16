import { Injectable } from '@nestjs/common';
import { TaskRunResult, TaskParseFailureError } from '../types/ai-analyst.types';
import { LlmClient } from '../llm/llm-client';
import { OutputSchema, parseAndValidate } from '../validation/json-output.validator';
import { buildExcerpt } from '../input/build-minimal-input';

/** 등락 방향. */
export type PriceMoveDirection = 'UP' | 'DOWN';

/** EventStudy 유사사례 통계(D+1/D+5/D+20) — n≥30 게이트 통과분만 전달(허수 방지). */
export interface ReactionStatSummary {
  /** 대표 이벤트 유형. */
  eventType: string;
  /** 표본수 n(≥30). */
  sampleCount: number;
  /** D+N 누적 단순수익률(%) / 시장 대비 초과수익(%) / 상승비율(0~1). */
  d1: HorizonStat;
  d5: HorizonStat;
  d20: HorizonStat;
}

export interface HorizonStat {
  avgReturn: number;
  avgAbnormalReturn: number | null;
  winRate: number;
}

/** 역방향 리즈닝 Task 입력 — 공시 이벤트 + 등락 방향 + EventStudy 유사사례 통계. */
export interface PriceMoveReasoningInput {
  /** causal 공시 접수번호. */
  rcpNo: string;
  corpName: string;
  /** 전일 종가 대비 등락률(%). */
  changePct: number;
  direction: PriceMoveDirection;
  /** 대표 이벤트 유형(미추출 시 'UNKNOWN'). */
  eventType: string;
  /** 공시 보고서명. */
  disclosureTitle: string;
  /** 공시 원문 핵심 단락(buildExcerpt 로 절단). 원문 전문 금지. */
  excerpt: string;
  /** EventStudy 유사사례 통계(n<30/미추출이면 null → 프롬프트에 '통계 없음' 명시). */
  reactionStats: ReactionStatSummary | null;
}

/**
 * 역방향 리즈닝 산출물 — ★설명층(원인 해석) 한정.
 * 매수/매도/목표가/점수/주문 등 판단·집행 필드는 스키마에 없다(AI 금지영역 무침범).
 */
export interface PriceMoveReasoningDraft {
  /** 공시가 이 방향/폭의 등락을 유발했다고 보는 근거 동반 원인 해석(2~4문장). */
  cause: string;
  /** 근거 목록(공시 이벤트·EventStudy 유사사례 통계 인용). */
  evidence: string[];
  /** 공시-등락 연관 강도(설명용 라벨 — 권고 아님). */
  eventLinkage: 'STRONG' | 'MODERATE' | 'WEAK' | 'UNCLEAR';
  /** 정직 한계 고지(상관≠인과·시장/수급 요인 가능성). */
  caveat: string;
}

const SYSTEM_PROMPT =
  '너는 한국 주식 공시 분석가다. 특정 종목이 오늘 ±5% 이상 급변동했고, 최근 48시간 내 공시가 있다. ' +
  '주어진 공시 이벤트·등락 방향·과거 유사공시의 실제 주가 반응 통계(EventStudy)만으로, ' +
  '이 급변동의 원인을 근거와 함께 해석하라. ' +
  // AI 금지영역 — 설명층 한정. 판단·집행 언어 금지.
  '★반드시 설명(원인 해석)만 한다: 매수/매도/보유 권고·목표가·투자의견·점수·주문 언급을 절대 하지 마라. ' +
  '통계가 없으면(표본 부족) 통계 근거 없이 공시 내용만으로 신중히 해석하고 caveat 에 명시하라. ' +
  '공시가 등락을 설명하지 못하면 eventLinkage 를 WEAK/UNCLEAR 로 두고 아는 척하지 마라(상관≠인과). ' +
  '추측·과장 금지. 반드시 JSON만 출력한다.';

const OUTPUT_SCHEMA: OutputSchema = {
  cause: { type: 'string' },
  evidence: { type: 'string[]' },
  eventLinkage: { type: 'enum', values: ['STRONG', 'MODERATE', 'WEAK', 'UNCLEAR'] },
  caveat: { type: 'string' },
};

/** 등락률(%)을 부호 포함 문자열로. */
function signedPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** EventStudy 통계 블록 — null 이면 '통계 없음(표본 부족)'. */
function formatReactionStats(stats: ReactionStatSummary | null): string {
  if (!stats) {
    return '과거 유사공시 반응 통계: 없음(표본 30건 미만 — 통계 근거 없이 신중 해석)';
  }
  const line = (label: string, h: HorizonStat): string => {
    const ar = h.avgAbnormalReturn === null ? 'N/A' : `${h.avgAbnormalReturn.toFixed(2)}%`;
    return `  ${label}: 평균수익 ${h.avgReturn.toFixed(2)}% · 시장대비 초과수익 ${ar} · 상승비율 ${(h.winRate * 100).toFixed(0)}%`;
  };
  return [
    `과거 유사공시(${stats.eventType}) 반응 통계 (n=${stats.sampleCount}):`,
    line('D+1', stats.d1),
    line('D+5', stats.d5),
    line('D+20', stats.d20),
  ].join('\n');
}

/**
 * L0~L3 — 역방향 리즈닝(설명층 원인 해석). 입력 최소화 + JSON 강제 + 화이트리스트 검증.
 * 오케스트레이션(비용게이트·한도가드·AIUsageLog·멱등 캐시)은 PriceMoveReasoningService 가 담당.
 */
@Injectable()
export class PriceMoveReasoningTask {
  constructor(private readonly llm: LlmClient) {}

  async run(input: PriceMoveReasoningInput): Promise<TaskRunResult<PriceMoveReasoningDraft>> {
    const dir = input.direction === 'UP' ? '상승' : '하락';
    const user = [
      `[종목] ${input.corpName}`,
      `[등락] 전일 종가 대비 ${signedPct(input.changePct)} (${dir})`,
      `[공시 이벤트 유형] ${input.eventType}`,
      `[공시 보고서명] ${input.disclosureTitle}`,
      `[공시 핵심 단락]\n${buildExcerpt(input.excerpt)}`,
      formatReactionStats(input.reactionStats),
      '',
      '위 정보만으로 다음 JSON을 출력하라: ' +
        '{ "cause": string, "evidence": string[], "eventLinkage": "STRONG"|"MODERATE"|"WEAK"|"UNCLEAR", "caveat": string }',
    ].join('\n');

    const res = await this.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonMode: true,
      maxOutputTokens: 600,
    });

    // 토큰은 이미 청구됨 — 파싱 실패 시에도 usage 보존해 비용 누락을 막는다(DAR-240).
    const usage = { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
    let result: PriceMoveReasoningDraft;
    try {
      result = parseAndValidate<PriceMoveReasoningDraft>(res.text, OUTPUT_SCHEMA);
    } catch (err) {
      throw new TaskParseFailureError(usage, err);
    }
    return { result, usage };
  }
}
