export interface Notification {
  id: string;
  userId: string;
  disclosureId: string;
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
