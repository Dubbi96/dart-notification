import type { NotificationType } from '../types/notification.types';

/**
 * DAR-432: 알림 '출처(source)' → 고유 이모지 + 출처명 단일 진실원천(SSOT, 모바일).
 *
 * ★백엔드 미러: backend/src/notifications/notification-source.ts 의 NOTIFICATION_SOURCES 와
 *   이모지·라벨이 정확히 일치해야 한다(scripts/check-notification-sources.ts 가 결정론 검증).
 *
 *  - DAR-430 카테고리(공시/신호/체결)는 채널·필터 축, 출처는 그보다 세분화된 발행원 축이다.
 *  - 인앱 알림탭에서 출처를 한눈에 식별하는 데 쓴다(공시 행 이모지 프리픽스 등).
 *  - 체결 알림 제목은 백엔드가 이모지+출처명을 이미 포함해 발행하므로(예: '⚡ 단타 · …'),
 *    인앱은 그 제목을 그대로 렌더한다. 조인 데이터로 렌더하는 공시 행만 이모지를 덧붙인다.
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
};

export const FALLBACK_SOURCE: NotificationSource = { key: 'unknown', emoji: '🔔', label: '알림' };

const TYPE_SOURCE_KEY: Partial<Record<NotificationType, string>> = {
  DISCLOSURE: 'disclosure',
  SIGNAL: 'signal',
  EXIT: 'exit',
  THESIS_VIOLATED: 'thesis',
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

/** "이모지 라벨" 프리픽스(예: '🤖 모의'). */
export function sourcePrefix(src: NotificationSource): string {
  return `${src.emoji} ${src.label}`;
}
