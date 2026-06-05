// 전체공시/검색 필터 옵션 정의 + 기간 계산 유틸 (DAR-45 §2).

export type PeriodKey = 'all' | '7d' | '1m' | '3m';
export type SortKey = 'latest' | 'relevance';

export interface PeriodOption {
  key: PeriodKey;
  label: string;
  /** 오늘 기준 거슬러 올라갈 일수 (all은 제한 없음 → null) */
  days: number | null;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'all', label: '전체기간', days: null },
  { key: '7d', label: '최근 7일', days: 7 },
  { key: '1m', label: '최근 1개월', days: 30 },
  { key: '3m', label: '최근 3개월', days: 90 },
];

export interface SortOption {
  key: SortKey;
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { key: 'latest', label: '최신순' },
  { key: 'relevance', label: '관련도순' },
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 오늘 기준 days일 전 날짜를 YYYYMMDD 문자열로 반환. */
export function daysAgoYmd(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/** 기간 키 → 백엔드 from(YYYYMMDD) 파라미터. all이면 undefined. */
export function periodToFrom(period: PeriodKey, now: Date = new Date()): string | undefined {
  const opt = PERIOD_OPTIONS.find((o) => o.key === period);
  if (!opt || opt.days == null) return undefined;
  return daysAgoYmd(opt.days, now);
}
