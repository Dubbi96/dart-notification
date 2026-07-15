export interface WatchlistItem {
  id: string;
  userId: string;
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  market: string | null;
  lastDisclosureDate: string | null;
  /** 마지막 조회(lastViewedAt) 이후 신규 공시 수 — unread 배지(DAR-165) */
  newDisclosureCount?: number;
  createdAt: string;
}

/**
 * Pro 출시 알림 사전신청 상태(갭분석 W1) — 서버 정본.
 * 기존 로컬 보관(useSettingsStore.proWaitlistOptIn)을 대체한다.
 */
export interface ProWaitlistStatus {
  optedIn: boolean;
  /** 최초 신청 시각(ISO). 미신청이면 null. */
  createdAt: string | null;
}

export interface NotificationSettings {
  userId: string;
  disclosureTypes: string[];
  keywords: string[];
  isEnabled: boolean;
  // DAR-85: 신호·청산·논리훼손 푸시 토글(기본 OFF). master isEnabled ON일 때만 발송.
  signalPushEnabled: boolean;
  exitPushEnabled: boolean;
  thesisPushEnabled: boolean;
  // DAR-424: 라이브 페이퍼 체결 알림 토글(기본 ON). OFF면 인박스·푸시 모두 생략.
  tradePushEnabled: boolean;
  // DAR-473(P01): 리스크·운영 알림 토글(기본 ON). OFF면 인박스·푸시 모두 생략.
  opsPushEnabled: boolean;
  // 갭분석 W7: 관심종목 급변동 알림 토글(★기본 OFF). OFF면 인박스·푸시 모두 생략.
  //   전일 종가 대비 ±5%·준실시간(최대 5분 지연).
  priceMovePushEnabled: boolean;
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
