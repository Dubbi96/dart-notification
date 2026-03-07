export interface WatchlistItem {
  id: string;
  userId: string;
  corpCode: string;
  corpName: string;
  createdAt: string;
}

export interface NotificationSettings {
  id: string;
  userId: string;
  disclosureTypes: string[];
  keywords: string[];
  isEnabled: boolean;
  updatedAt: string;
}

export interface Company {
  id: string;
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  market: string | null;
}
