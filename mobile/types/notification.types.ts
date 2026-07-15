// DAR-84: 통합 알림 인박스 — 공시 외 신호·청산·논리훼손 통지를 한 타입으로 수용
// DAR-424: 라이브 페이퍼 체결(매수/매도) 알림 타입 추가.
// DAR-473(P01): 리스크·운영 알림 타입 추가(RISK_ALERT/OPS_ALERT).
// 갭분석 W7: 관심종목 급변동 알림 타입 추가(PRICE_MOVE — 전일 대비 ±5%, 준실시간 최대 5분 지연).
export type NotificationType =
  | 'DISCLOSURE'
  | 'SIGNAL'
  | 'EXIT'
  | 'THESIS_VIOLATED'
  | 'TRADE_ENTRY'
  | 'TRADE_EXIT'
  | 'RISK_ALERT'
  | 'OPS_ALERT'
  | 'PRICE_MOVE';

// DAR-430: 알림 카테고리 — Android 채널·인앱 필터의 단일 진실원천.
//  - 공시(disclosure): DISCLOSURE
//  - 신호(signal):    SIGNAL · EXIT · THESIS_VIOLATED · PRICE_MOVE (갭분석 W7)
//  - 체결(trade):     TRADE_ENTRY · TRADE_EXIT
//  - 운영(system):    RISK_ALERT · OPS_ALERT   (DAR-473 P01)
export type NotificationCategory = 'disclosure' | 'signal' | 'trade' | 'system';

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  DISCLOSURE: 'disclosure',
  SIGNAL: 'signal',
  EXIT: 'signal',
  THESIS_VIOLATED: 'signal',
  TRADE_ENTRY: 'trade',
  TRADE_EXIT: 'trade',
  // DAR-473(P01): 리스크·운영 알림 → 'system' 버킷.
  RISK_ALERT: 'system',
  OPS_ALERT: 'system',
  // 갭분석 W7: 급변동 → 시세성 사용자 알림이므로 'signal' 버킷(백엔드 SSOT 정합).
  PRICE_MOVE: 'signal',
};

// 카테고리 → Android 알림 채널 ID(=백엔드 Expo push channelId 와 정확히 일치).
export const CATEGORY_CHANNEL_ID: Record<NotificationCategory, string> = {
  disclosure: 'disclosure',
  signal: 'signal',
  trade: 'trade',
  // DAR-473(P01): 리스크·운영 알림 채널.
  system: 'system',
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
