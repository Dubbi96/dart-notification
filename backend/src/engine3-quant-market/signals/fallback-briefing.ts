// backend/src/engine3-quant-market/signals/fallback-briefing.ts
// DAR-551 (BE·P0·오너결정 A안) — 빈 에디션 폴백 '오늘의 주요 공시 브리핑' 순수 매핑 SSOT.
//
// 배경(밀도 폴백 A안): 빈 날(매수판단 0)이 실측 85%다. 빈 에디션 상세 응답이 아무것도
//   보여주지 못하면 신호탭이 죽은 화면이 된다. 그 KST 거래일의 '주요 공시'를 브리핑으로
//   분리 노출해 밀도를 채운다.
//
// ★정직 불변식: 이 브리핑은 '판단(에디션 item)'이 아니라 '주요 공시 브리핑'이다.
//   - daily-editions 목록·count·detail 의 data(items) 는 무변경 — 빈 날은 여전히 판단 0.
//   - 브리핑은 detail 응답 `meta.fallbackBriefing` 로만 실린다(판단 배열과 물리적 분리).
//   - 신규 AI 호출 0: 기존 DisclosureAnalysis(summary task) 캐시만 재사용. 요약이 없으면
//     공시 제목(reportName)으로 폴백하고 출처를 `summarySource` 로 정직 표기한다.
//
// 이 파일은 순수(I/O·시각·DI 없음) — 결정론 단위테스트(fallback-briefing.spec.ts)로 고정한다.

import { EVENT_PUSH_LEAD_LABEL } from '../../notifications/push-body-template';

/** 브리핑 top N — 잠금화면/리스트 밀도 관례상 5건. */
export const FALLBACK_BRIEFING_LIMIT = 5;

/** 브리핑 한 줄 최대 길이(문자). 초과 시 말줄임(…) — 리스트 1줄 밀도 유지. */
export const SUMMARY_LINE_MAX_LEN = 100;

/** 이벤트 미분류(OTHER·이벤트 없음) 공시 라벨 폴백. */
export const DEFAULT_EVENT_LABEL = '기타 공시';

/** 브리핑 한 줄의 출처 — AI 요약 재사용인지 제목 폴백인지 정직 표기. */
export type FallbackSummarySource = 'AI' | 'TITLE';

/** $queryRaw 원시 행(랭킹·LIMIT 은 SQL 이 수행, 이 행들은 이미 정렬됨). */
export interface FallbackBriefingRow {
  rcpNo: string;
  corpName: string;
  reportName: string;
  /** DisclosureEvent.eventType(text) — 이벤트 미분류 공시는 null. */
  eventType: string | null;
  /** DisclosureAnalysis(summary task) resultJson->>'summary' — 캐시 없으면 null. */
  summaryText: string | null;
}

/** 응답 `meta.fallbackBriefing[]` 항목. */
export interface FallbackBriefingItem {
  rcpNo: string;
  corpName: string;
  /** 이벤트 라벨(한국어) — 표기 SSOT: notifications/push-body-template EVENT_PUSH_LEAD_LABEL. */
  eventLabel: string;
  /** 주요 내용 한 줄(AI 요약 재사용 또는 제목 폴백, 공백 정규화 + 말줄임). */
  summaryLine: string;
  summarySource: FallbackSummarySource;
}

/**
 * 여러 줄/연속 공백을 단일 공백으로 접고 maxLen 초과 시 말줄임(…)으로 절단해
 * '한 줄' 밀도를 보장한다.
 */
export function toOneLineSummary(text: string, maxLen = SUMMARY_LINE_MAX_LEN): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen - 1)}…`;
}

/**
 * eventType → 한국어 이벤트 라벨. 이벤트 미분류(null)·OTHER·미등록 타입은 '기타 공시'.
 * push 표기(EVENT_PUSH_LEAD_LABEL)를 그대로 재사용해 드리프트 0.
 */
export function resolveEventLabel(eventType: string | null): string {
  if (!eventType || eventType === 'OTHER') return DEFAULT_EVENT_LABEL;
  return EVENT_PUSH_LEAD_LABEL[eventType] ?? DEFAULT_EVENT_LABEL;
}

/**
 * 이미 중요도 순으로 정렬된 원시 행을 응답 DTO 로 매핑한다.
 * AI 요약(summaryText)이 있으면 재사용(source=AI), 없으면 제목(reportName)으로 폴백(source=TITLE).
 */
export function buildFallbackBriefingItems(
  rows: FallbackBriefingRow[],
): FallbackBriefingItem[] {
  return rows.map((r) => {
    const aiSummary =
      r.summaryText && r.summaryText.trim().length > 0 ? r.summaryText : null;
    return {
      rcpNo: r.rcpNo,
      corpName: r.corpName,
      eventLabel: resolveEventLabel(r.eventType),
      summaryLine: toOneLineSummary(aiSummary ?? r.reportName),
      summarySource: aiSummary ? 'AI' : 'TITLE',
    };
  });
}
