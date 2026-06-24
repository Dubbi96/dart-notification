// DAR-84: 통합 알림 인박스 — 공시 외 신호·청산·논리훼손 통지를 한 타입으로 수용
// DAR-424: 라이브 페이퍼 체결(매수/매도) 알림 타입 추가.
export type NotificationType =
  | 'DISCLOSURE'
  | 'SIGNAL'
  | 'EXIT'
  | 'THESIS_VIOLATED'
  | 'TRADE_ENTRY'
  | 'TRADE_EXIT';

// DAR-430: 알림 카테고리(3 버킷) — Android 채널·인앱 필터의 단일 진실원천.
//  - 공시(disclosure): DISCLOSURE
//  - 신호(signal):    SIGNAL · EXIT · THESIS_VIOLATED
//  - 체결(trade):     TRADE_ENTRY · TRADE_EXIT
export type NotificationCategory = 'disclosure' | 'signal' | 'trade';

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  DISCLOSURE: 'disclosure',
  SIGNAL: 'signal',
  EXIT: 'signal',
  THESIS_VIOLATED: 'signal',
  TRADE_ENTRY: 'trade',
  TRADE_EXIT: 'trade',
};

// 카테고리 → Android 알림 채널 ID(=백엔드 Expo push channelId 와 정확히 일치).
export const CATEGORY_CHANNEL_ID: Record<NotificationCategory, string> = {
  disclosure: 'disclosure',
  signal: 'signal',
  trade: 'trade',
};

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  refId: string | null;
  title: string | null;
  body: string | null;
  deepLink: string | null;
  // 공시 외 타입은 nullable (FK 미강결합)
  disclosureRcpNo: string | null;
  sentAt: string;
  isRead: boolean;
  readAt: string | null;
  // 공시 타입일 때만 조인됨 (다형: 그 외 null)
  disclosure: {
    rcpNo: string;
    corpCode: string;
    corpName: string;
    reportName: string;
    disclosureType: string;
  } | null;
}
