import type { NotificationType } from '../types/notification.types';

/**
 * DAR-432: 알림 '출처(source)' → 고유 이모지 + 출처명 단일 진실원천(SSOT, 모바일).
 *
 * ★백엔드 미러: backend/src/notifications/notification-source.ts 의 NOTIFICATION_SOURCES 와
 *   이모지·라벨이 정확히 일치해야 한다(scripts/check-notification-sources.ts 가 결정론 검증).
 *
 *  - DAR-430 카테고리(공시/신호/체결)는 채널·필터 축, 출처는 그보다 세분화된 발행원 축이다.
 *  - 이모지는 **푸시 페이로드(OS 알림) 전용** 시각 언어다. 백엔드는 제목에 이모지+출처명을
 *    포함해 발행하고(예: '⚡ 단타 · …'), 푸시에서는 그대로 노출한다.
 *  - UXR-16(C-1): 인앱 알림 행은 Feather 벡터 아이콘으로 일원화한다 — 백엔드 제목을
 *    인앱에 렌더할 때는 stripSourceEmoji 로 선두 출처 이모지를 제거해 이중 표기를 없앤다.
 */
export interface NotificationSource {
  key: string;
  emoji: string;
  label: string;
}

export const NOTIFICATION_SOURCES: Record<string, NotificationSource> = {
  // 체결 외(NotificationType 파생)
  disclosure: { key: 'disclosure', emoji: '📢', label: '공시' },
  signal: { key: 'signal', emoji: '📈', label: '매수신호' },
  exit: { key: 'exit', emoji: '🔻', label: '청산' },
  thesis: { key: 'thesis', emoji: '⚠️', label: '논리훼손' },
  // 체결(트랙 strategyKey)
  'paper-simulation': { key: 'paper-simulation', emoji: '🤖', label: '모의' },
  'intraday-scalp': { key: 'intraday-scalp', emoji: '⚡', label: '단타' },
  'event-edge': { key: 'event-edge', emoji: '🎯', label: '이벤트엣지' },
  'short-momentum': { key: 'short-momentum', emoji: '🚀', label: '단기모멘텀' },
  'conservative-value': { key: 'conservative-value', emoji: '🛡️', label: '보수가치' },
  'aggressive-diversified': { key: 'aggressive-diversified', emoji: '💥', label: '공격분산' },
  // 리스크·운영(DAR-473 P01·NotificationType 파생)
  risk: { key: 'risk', emoji: '🛑', label: '리스크' },
  ops: { key: 'ops', emoji: '⚙️', label: '운영' },
};

export const FALLBACK_SOURCE: NotificationSource = { key: 'unknown', emoji: '🔔', label: '알림' };

const TYPE_SOURCE_KEY: Partial<Record<NotificationType, string>> = {
  DISCLOSURE: 'disclosure',
  SIGNAL: 'signal',
  EXIT: 'exit',
  THESIS_VIOLATED: 'thesis',
  // DAR-473(P01): 리스크·운영 알림 출처.
  RISK_ALERT: 'risk',
  OPS_ALERT: 'ops',
};

/** 출처 키로 출처 조회(미상은 폴백). */
export function sourceByKey(key?: string | null): NotificationSource {
  if (key && NOTIFICATION_SOURCES[key]) return NOTIFICATION_SOURCES[key];
  return FALLBACK_SOURCE;
}

/** NotificationType(체결 외) → 출처. 체결 타입은 strategyKey 가 필요하므로 폴백. */
export function sourceByType(type: NotificationType): NotificationSource {
  return sourceByKey(TYPE_SOURCE_KEY[type]);
}

/** "이모지 라벨" 프리픽스(예: '🤖 모의') — 푸시 페이로드 제목 템플릿용(be↔fe 형식 검증). */
export function sourcePrefix(src: NotificationSource): string {
  return `${src.emoji} ${src.label}`;
}

// UXR-16(C-1): SSOT 이모지 집합(폴백 포함) — 인앱 렌더 시 선두 이모지 제거의 결정론 근거.
const SOURCE_EMOJIS: readonly string[] = [
  ...Object.values(NOTIFICATION_SOURCES).map((s) => s.emoji),
  FALLBACK_SOURCE.emoji,
];

/**
 * 백엔드 발행 제목의 선두 출처 이모지를 제거한다(인앱 행 전용).
 * SSOT 집합에 있는 이모지만 결정론적으로 제거하고, 임의 텍스트/이모지는 보존한다.
 * 예: '⚡ 단타 · 삼성전자 매도 +2.10%' → '단타 · 삼성전자 매도 +2.10%'.
 */
export function stripSourceEmoji(title: string): string {
  for (const emoji of SOURCE_EMOJIS) {
    if (title.startsWith(`${emoji} `)) return title.slice(emoji.length + 1);
    if (title.startsWith(emoji)) return title.slice(emoji.length);
  }
  return title;
}
