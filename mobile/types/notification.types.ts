// DAR-84: 통합 알림 인박스 — 공시 외 신호·청산·논리훼손 통지를 한 타입으로 수용
export type NotificationType = 'DISCLOSURE' | 'SIGNAL' | 'EXIT' | 'THESIS_VIOLATED';

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
