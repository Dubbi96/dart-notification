import { NotificationType } from '@prisma/client';

/**
 * DAR-430: 알림 카테고리(3 버킷) — 단일 진실원천(SSOT).
 *
 * 사용처:
 *  - Android 알림 채널 ID(=Expo push `channelId`): OS 가 채널별로 묶어 표시·누적·중요도 분리.
 *  - 인앱 알림탭 카테고리 필터(전체·공시·신호·체결).
 *  - 푸시 payload 의 androidChannelId 지정.
 *
 * 버킷:
 *  - 공시(disclosure): DISCLOSURE
 *  - 신호(signal):    SIGNAL · EXIT · THESIS_VIOLATED
 *  - 체결(trade):     TRADE_ENTRY · TRADE_EXIT  (시스템 트레이딩 체결)
 */
export type NotificationCategory = 'disclosure' | 'signal' | 'trade';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'disclosure',
  'signal',
  'trade',
] as const;

/** NotificationType → 카테고리 매핑. */
export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  [NotificationType.DISCLOSURE]: 'disclosure',
  [NotificationType.SIGNAL]: 'signal',
  [NotificationType.EXIT]: 'signal',
  [NotificationType.THESIS_VIOLATED]: 'signal',
  [NotificationType.TRADE_ENTRY]: 'trade',
  [NotificationType.TRADE_EXIT]: 'trade',
};

/** 카테고리 → 포함 NotificationType 목록(쿼리 필터용). */
export const CATEGORY_TYPES: Record<NotificationCategory, NotificationType[]> = {
  disclosure: [NotificationType.DISCLOSURE],
  signal: [
    NotificationType.SIGNAL,
    NotificationType.EXIT,
    NotificationType.THESIS_VIOLATED,
  ],
  trade: [NotificationType.TRADE_ENTRY, NotificationType.TRADE_EXIT],
};

/**
 * 카테고리 → Android 알림 채널 ID(=Expo push channelId).
 * ★모바일 `setNotificationChannelAsync` 등록 채널 ID 와 정확히 일치해야 한다.
 */
export const CATEGORY_CHANNEL_ID: Record<NotificationCategory, string> = {
  disclosure: 'disclosure',
  signal: 'signal',
  trade: 'trade',
};

/** NotificationType → Android 채널 ID(=Expo push channelId). */
export function channelIdForType(type: NotificationType): string {
  return CATEGORY_CHANNEL_ID[NOTIFICATION_CATEGORY[type]];
}
