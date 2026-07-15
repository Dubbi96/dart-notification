// backend/src/notifications/event-type-copy.ts
// W9 정직 라벨링 — 알림 문구용 실적 이벤트 한국어 카피 SSOT.
//
// 배경: 매수신호 알림 본문이 eventType 원문(enum)을 그대로 실었다. 실적 이벤트는
//   판정 기준이 전년동기(YoY) 대비(extractors/earnings.ts ±20% 임계)인데 기준 없이
//   '실적 서프라이즈'로만 나가면 시장 기대치 대비 판정으로 오인될 수 있다 — 대형주
//   실적시즌에 시장 판정과 부호가 어긋나는 순간 알림 신뢰가 직접 훼손된다.
//   가이던스는 회사 자체 전망이며 애널리스트 추정 집계가 아님을 함께 명시한다.
//   (모바일 표기 SSOT 는 mobile/utils/disclosureType.ts EVENT_TYPE_LABEL — 동일 카피 유지)

/** 실적 이벤트 알림 카피 — 판정 기준(전년동기 대비/자사 전망)을 항상 병기한다. */
export const EVENT_TYPE_NOTIFICATION_COPY: Record<string, string> = {
  EARNINGS_SURPRISE: '실적 서프라이즈(전년동기 대비)',
  EARNINGS_SHOCK: '실적 쇼크(전년동기 대비)',
  EARNINGS_GUIDANCE: '실적 가이던스(자사 전망)',
};

/**
 * 알림 문구용 이벤트 카피. 실적 이벤트는 기준 병기 한국어 카피로 치환하고,
 * 그 외 타입은 기존 동작(원문 유지)을 보존한다.
 */
export function eventTypeNotificationCopy(
  eventType?: string | null,
): string | undefined {
  if (!eventType) return undefined;
  return EVENT_TYPE_NOTIFICATION_COPY[eventType] ?? eventType;
}
