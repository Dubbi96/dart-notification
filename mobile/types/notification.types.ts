export interface Notification {
  id: string;
  userId: string;
  disclosureRcpNo: string;
  sentAt: string;
  isRead: boolean;
  readAt: string | null;
  disclosure: {
    rcpNo: string;
    corpCode: string;
    corpName: string;
    reportName: string;
    disclosureType: string;
  };
}
