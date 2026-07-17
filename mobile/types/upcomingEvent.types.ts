// DAR-538: 공시발 예정 이벤트 캘린더 v1 — 백엔드 UpcomingEventsService DTO 1:1 미러.
// 라벨 SSOT는 백엔드 upcoming-event.deriver.ts(UPCOMING_EVENT_LABELS) — FE는 label을 그대로 표시.

export type UpcomingEventKind =
  | 'DIVIDEND_RECORD' // 배당 기준일
  | 'DIVIDEND_PAYMENT' // 배당 지급일
  | 'SUBSCRIPTION' // 유상증자 청약일
  | 'NEW_SHARES_LISTING' // 신주 상장 예정일
  | 'BOND_MATURITY' // CB/BW 만기일
  | 'BUYBACK_END' // 자사주 취득 종료일
  | 'TRADING_RESUME'; // 거래재개 예정일

export interface UpcomingEventItem {
  kind: UpcomingEventKind;
  /** 사용자 노출 한국어 라벨 (백엔드 SSOT) */
  label: string;
  /** 이벤트 날짜 YYYY-MM-DD */
  date: string;
  /** baseDate(서버 KST 오늘) 기준 D-day — 0 = 오늘 */
  dDay: number;
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  /** 근거 공시 접수번호 — 공시 상세 딥링크 */
  rcpNo: string;
  eventType: string;
}

export interface UpcomingEventsResult {
  /** 서버 KST 기준 오늘 YYYY-MM-DD (D-day 산정 기준일) */
  baseDate: string;
  /** 조회 윈도 일수 */
  days: number;
  items: UpcomingEventItem[];
}
