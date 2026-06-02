export interface WatchlistItem {
  id: string;
  userId: string;
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  market: string | null;
  lastDisclosureDate: string | null;
  createdAt: string;
}

export interface NotificationSettings {
  userId: string;
  disclosureTypes: string[];
  keywords: string[];
  isEnabled: boolean;
  updatedAt: string;
}

export interface Company {
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  market: string | null;
}

export interface CompanyOverview {
  corpCode: string;
  corpName: string;
  corpNameEng: string | null;
  stockName: string | null;
  ceoName: string | null;
  corpCls: string | null;
  address: string | null;
  homepageUrl: string | null;
  industryCode: string | null;
  estDate: string | null;
  accMonth: string | null;
}

export interface CompanyDetail extends Company {
  overview: CompanyOverview | null;
  recentDisclosures: Array<{
    rcpNo: string;
    corpName: string;
    corpCode: string;
    reportName: string;
    rcpDt: string;
    disclosureType: string;
  }>;
}
