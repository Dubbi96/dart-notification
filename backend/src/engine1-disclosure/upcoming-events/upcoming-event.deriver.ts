// backend/src/engine1-disclosure/upcoming-events/upcoming-event.deriver.ts
// DAR-538: 공시발 예정 이벤트 캘린더 v1 — DisclosureEvent.extractedData의 날짜 필드에서
//   미래 예정 이벤트를 파생하는 순수 함수 계층 (DB·Nest 무의존, AI 미사용).
//
// 정직 규약: 추출기가 실제로 남긴 유효한 YYYY-MM-DD 값만 이벤트로 파생한다.
//   결측·형식 불일치·비실재 달력 날짜는 조용히 제외(날짜 발명 금지).
//   보호예수 해제일은 현 파이프라인에 데이터 소스가 없어 v1 미지원(후속 이슈).

import { EventType } from '@prisma/client';

// ─── 이벤트 종류 ─────────────────────────────────────────────────────────────

export type UpcomingEventKind =
  | 'DIVIDEND_RECORD' // 배당 기준일
  | 'DIVIDEND_PAYMENT' // 배당 지급일
  | 'SUBSCRIPTION' // 유상증자 청약일
  | 'NEW_SHARES_LISTING' // 신주 상장 예정일
  | 'BOND_MATURITY' // CB/BW 만기일
  | 'BUYBACK_END' // 자사주 취득 종료일
  | 'TRADING_RESUME'; // 거래재개 예정일

/** 사용자 노출 한국어 라벨 SSOT (FE 미러: mobile/types/upcomingEvent.types.ts) */
export const UPCOMING_EVENT_LABELS: Record<UpcomingEventKind, string> = {
  DIVIDEND_RECORD: '배당 기준일',
  DIVIDEND_PAYMENT: '배당 지급일',
  SUBSCRIPTION: '유상증자 청약일',
  NEW_SHARES_LISTING: '신주 상장 예정일',
  BOND_MATURITY: '사채 만기일',
  BUYBACK_END: '자사주 취득 종료일',
  TRADING_RESUME: '거래재개 예정일',
};

// ─── eventType → (extractedData 날짜 필드, kind) 매핑 ───────────────────────
// 필드명 정본은 각 extractor 인터페이스(dividend.ts·capital-increase.ts·cb-bw.ts·
// share-buyback.ts·trading-suspension.ts)다.

interface DateFieldRule {
  field: string;
  kind: UpcomingEventKind;
}

const DIVIDEND_RULES: readonly DateFieldRule[] = [
  { field: 'recordDate', kind: 'DIVIDEND_RECORD' },
  { field: 'paymentDate', kind: 'DIVIDEND_PAYMENT' },
];

const CAPITAL_INCREASE_RULES: readonly DateFieldRule[] = [
  { field: 'subscriptionDate', kind: 'SUBSCRIPTION' },
  { field: 'listingDate', kind: 'NEW_SHARES_LISTING' },
];

const CB_BW_RULES: readonly DateFieldRule[] = [
  { field: 'maturityDate', kind: 'BOND_MATURITY' },
];

const DATE_FIELD_MAP: Partial<Record<EventType, readonly DateFieldRule[]>> = {
  [EventType.DIVIDEND_INCREASE]: DIVIDEND_RULES,
  [EventType.DIVIDEND_CUT]: DIVIDEND_RULES,
  [EventType.PAID_IN_CAPITAL_INCREASE]: CAPITAL_INCREASE_RULES,
  [EventType.THIRD_PARTY_ALLOTMENT]: CAPITAL_INCREASE_RULES,
  [EventType.CB_ISSUANCE]: CB_BW_RULES,
  [EventType.BW_ISSUANCE]: CB_BW_RULES,
  [EventType.SHARE_BUYBACK]: [{ field: 'buybackPeriodEnd', kind: 'BUYBACK_END' }],
  [EventType.TRADING_SUSPENSION]: [{ field: 'expectedResumeDate', kind: 'TRADING_RESUME' }],
};

/** 예정 이벤트를 파생할 수 있는 eventType 목록 (DB 조회 필터용) */
export const UPCOMING_EVENT_TYPES: readonly EventType[] = Object.keys(
  DATE_FIELD_MAP,
) as EventType[];

// ─── 날짜 검증 유틸 ──────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * 엄격한 YYYY-MM-DD 검증 — 형식 + 실재 달력 날짜(2026-02-30 등 배제).
 * 정직 규약의 게이트: 여기서 탈락하면 이벤트 자체를 만들지 않는다.
 */
export function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, y, mo, d] = m;
  const utc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    utc.getUTCFullYear() === Number(y) &&
    utc.getUTCMonth() === Number(mo) - 1 &&
    utc.getUTCDate() === Number(d)
  );
}

/** YYYY-MM-DD → UTC 자정 epoch ms (isValidYmd 통과값 전제) */
function ymdToUtcMs(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  return Date.UTC(y, mo - 1, d);
}

/** target - base 일수 차 (둘 다 YYYY-MM-DD). D-day 계산 정본. */
export function diffDaysYmd(targetYmd: string, baseYmd: string): number {
  return Math.round((ymdToUtcMs(targetYmd) - ymdToUtcMs(baseYmd)) / MS_PER_DAY);
}

/** YYYY-MM-DD에 n일 더한 YYYY-MM-DD */
export function addDaysYmd(ymd: string, days: number): string {
  return new Date(ymdToUtcMs(ymd) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// ─── 단건 파생 ───────────────────────────────────────────────────────────────

export interface DerivedUpcomingEvent {
  kind: UpcomingEventKind;
  label: string;
  /** 이벤트 날짜 YYYY-MM-DD */
  date: string;
}

/**
 * 이벤트 1건의 extractedData에서 예정 이벤트 후보를 파생한다.
 * 매핑에 없는 eventType·비객체 extractedData·유효하지 않은 날짜 → 빈 배열.
 */
export function deriveUpcomingEvents(
  eventType: EventType,
  extractedData: unknown,
): DerivedUpcomingEvent[] {
  const rules = DATE_FIELD_MAP[eventType];
  if (!rules) return [];
  if (typeof extractedData !== 'object' || extractedData === null) return [];

  const data = extractedData as Record<string, unknown>;
  const result: DerivedUpcomingEvent[] = [];
  for (const { field, kind } of rules) {
    const raw = data[field];
    if (!isValidYmd(raw)) continue;
    result.push({ kind, label: UPCOMING_EVENT_LABELS[kind], date: raw });
  }
  return result;
}

// ─── 목록 파생 (supersede·윈도·dedup·정렬) ──────────────────────────────────

export interface UpcomingEventSourceRow {
  rcpNo: string;
  corpCode: string;
  eventType: EventType;
  extractedData: unknown;
  isAmendment: boolean;
  originalRcpNo: string | null;
}

export interface DerivedUpcomingEventWithRow<T extends UpcomingEventSourceRow>
  extends DerivedUpcomingEvent {
  row: T;
}

/**
 * DisclosureEvent 행 집합 → [fromDate, toDate] 윈도의 예정 이벤트 목록.
 *
 * - 정정공시 supersede: 어떤 행의 originalRcpNo로 지목된 원공시 행은 제외
 *   (정정이 날짜를 바꿨을 때 구 날짜가 유령으로 남는 것 방지).
 * - dedup: (corpCode, kind, date) 동일 항목은 최신 접수번호(rcpNo 최대) 1건만.
 *   날짜가 다르면 별개 이벤트로 모두 유지(동일 기업의 병행 CB 만기 등은 실재).
 * - 정렬: date asc → corpCode asc → kind asc → rcpNo asc (결정론).
 */
export function deriveUpcomingEventsFromRows<T extends UpcomingEventSourceRow>(
  rows: readonly T[],
  window: { fromDate: string; toDate: string },
): DerivedUpcomingEventWithRow<T>[] {
  const supersededRcpNos = new Set<string>();
  for (const row of rows) {
    if (row.isAmendment && row.originalRcpNo) supersededRcpNos.add(row.originalRcpNo);
  }

  const byDedupKey = new Map<string, DerivedUpcomingEventWithRow<T>>();
  for (const row of rows) {
    if (supersededRcpNos.has(row.rcpNo)) continue;
    for (const derived of deriveUpcomingEvents(row.eventType, row.extractedData)) {
      if (derived.date < window.fromDate || derived.date > window.toDate) continue;
      const key = `${row.corpCode}|${derived.kind}|${derived.date}`;
      const existing = byDedupKey.get(key);
      if (existing && existing.row.rcpNo >= row.rcpNo) continue;
      byDedupKey.set(key, { ...derived, row });
    }
  }

  return [...byDedupKey.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.row.corpCode.localeCompare(b.row.corpCode) ||
      a.kind.localeCompare(b.kind) ||
      a.row.rcpNo.localeCompare(b.row.rcpNo),
  );
}
