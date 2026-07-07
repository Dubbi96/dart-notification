import type { NotificationType } from '../types/notification.types';

/**
 * DAR-432 → 2026-07-06 개정: 알림 '출처(source)' → 출처명(라벨) 단일 진실원천(SSOT, 모바일).
 *
 * ★백엔드 미러: backend/src/notifications/notification-source.ts 의 NOTIFICATION_SOURCES 와
 *   라벨이 정확히 일치해야 한다(scripts/check-notification-sources.ts 가 결정론 검증).
 *
 *  - ★이모지 미사용(사용자 결정 2026-07-06): 출처 구분은 라벨 텍스트 프리픽스(푸시 제목
 *    '{출처} · {내용}')가 담당한다. 인앱 행은 Feather 아이콘+타입 컬러(UXR-16 C-1)로 구분.
 *  - DAR-430 카테고리(공시/신호/체결)는 채널·필터 축, 출처는 그보다 세분화된 발행원 축이다.
 */
export interface NotificationSource {
  key: string;
  label: string;
}

export const NOTIFICATION_SOURCES: Record<string, NotificationSource> = {
  // 체결 외(NotificationType 파생)
  disclosure: { key: 'disclosure', label: '공시' },
  signal: { key: 'signal', label: '매수신호' },
  exit: { key: 'exit', label: '청산' },
  thesis: { key: 'thesis', label: '논리훼손' },
  // 체결(트랙 strategyKey)
  'paper-simulation': { key: 'paper-simulation', label: '모의' },
  'intraday-scalp': { key: 'intraday-scalp', label: '단타' },
  'event-edge': { key: 'event-edge', label: '이벤트엣지' },
  'short-momentum': { key: 'short-momentum', label: '단기모멘텀' },
  'conservative-value': { key: 'conservative-value', label: '보수가치' },
  'aggressive-diversified': { key: 'aggressive-diversified', label: '공격분산' },
  // 체결(철학 스타일 4종 — 개장 체결 정렬 2026-07-06로 철학 트랙도 체결 알림 발행)
  BUFFETT: { key: 'BUFFETT', label: '버핏' },
  LYNCH: { key: 'LYNCH', label: '린치' },
  GREENBLATT: { key: 'GREENBLATT', label: '그린블라트' },
  DRUCKENMILLER: { key: 'DRUCKENMILLER', label: '드러켄밀러' },
  // 리스크·운영(DAR-473 P01·NotificationType 파생)
  risk: { key: 'risk', label: '리스크' },
  ops: { key: 'ops', label: '운영' },
};

export const FALLBACK_SOURCE: NotificationSource = { key: 'unknown', label: '알림' };

const TYPE_SOURCE_KEY: Partial<Record<NotificationType, string>> = {
  DISCLOSURE: 'disclosure',
  SIGNAL: 'signal',
  EXIT: 'exit',
  THESIS_VIOLATED: 'thesis',
  // DAR-473(P01): 리스크·운영 알림 출처.
  RISK_ALERT: 'risk',
  OPS_ALERT: 'ops',
};

/** 출처 키로 출처 조회(미상은 폴백).
 *  전략 forward 체결(개장 체결 정렬 2026-07-06)은 strategyKey='strategy:<key>' —
 *  접두사를 벗겨 프리셋 키로 정규화해 동일 라벨 SSOT 를 재사용한다(백엔드 미러). */
export function sourceByKey(key?: string | null): NotificationSource {
  if (!key) return FALLBACK_SOURCE;
  const normalized = key.startsWith('strategy:') ? key.slice('strategy:'.length) : key;
  return NOTIFICATION_SOURCES[normalized] ?? FALLBACK_SOURCE;
}

/** NotificationType(체결 외) → 출처. 체결 타입은 strategyKey 가 필요하므로 폴백. */
export function sourceByType(type: NotificationType): NotificationSource {
  return sourceByKey(TYPE_SOURCE_KEY[type]);
}

/** 출처 라벨 프리픽스(예: '모의') — 푸시 페이로드 제목 템플릿용(be↔fe 형식 검증). */
export function sourcePrefix(src: NotificationSource): string {
  return src.label;
}

/**
 * ★레거시 전용(2026-07-06 이전 발행분): 과거 백엔드는 제목 선두에 출처 이모지를 붙였다.
 * NotificationHistory(인박스)에 이미 영속된 옛 제목을 렌더할 때만 제거한다.
 * 신규 발행 제목엔 이모지가 없으므로 이 목록은 더 자라지 않는다(동결).
 */
const LEGACY_SOURCE_EMOJIS: readonly string[] = [
  '📢',
  '📈',
  '🔻',
  '⚠️',
  '🤖',
  '⚡',
  '🎯',
  '🚀',
  '🛡️',
  '💥',
  '🛑',
  '⚙️',
  '🔔',
];

/**
 * 제목 선두의 레거시 출처 이모지를 제거한다(인앱 행 전용).
 * 동결된 레거시 집합에 있는 이모지만 결정론적으로 제거하고, 임의 텍스트는 보존한다.
 * 예: '⚡ 단타 · 삼성전자 매도 +2.10%' → '단타 · 삼성전자 매도 +2.10%'.
 */
export function stripSourceEmoji(title: string): string {
  for (const emoji of LEGACY_SOURCE_EMOJIS) {
    if (title.startsWith(`${emoji} `)) return title.slice(emoji.length + 1);
    if (title.startsWith(emoji)) return title.slice(emoji.length);
  }
  return title;
}
