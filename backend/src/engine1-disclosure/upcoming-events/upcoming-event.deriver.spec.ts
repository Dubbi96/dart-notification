// backend/src/engine1-disclosure/upcoming-events/upcoming-event.deriver.spec.ts
// DAR-538: 예정 이벤트 파생기 단위 테스트 (순수 함수 — DB/Nest 무의존)

import { EventType } from '@prisma/client';
import {
  UPCOMING_EVENT_LABELS,
  UPCOMING_EVENT_TYPES,
  UpcomingEventSourceRow,
  addDaysYmd,
  deriveUpcomingEvents,
  deriveUpcomingEventsFromRows,
  diffDaysYmd,
  isValidYmd,
} from './upcoming-event.deriver';

describe('isValidYmd (정직 규약 게이트)', () => {
  it('유효한 YYYY-MM-DD만 통과한다', () => {
    expect(isValidYmd('2026-08-03')).toBe(true);
    expect(isValidYmd('2026-12-31')).toBe(true);
  });

  it('형식 불일치·비문자열은 거부한다', () => {
    expect(isValidYmd('20260803')).toBe(false);
    expect(isValidYmd('2026.08.03')).toBe(false);
    expect(isValidYmd('2026-8-3')).toBe(false);
    expect(isValidYmd('미정')).toBe(false);
    expect(isValidYmd('')).toBe(false);
    expect(isValidYmd(null)).toBe(false);
    expect(isValidYmd(undefined)).toBe(false);
    expect(isValidYmd(20260803)).toBe(false);
  });

  it('실재하지 않는 달력 날짜를 거부한다', () => {
    expect(isValidYmd('2026-02-30')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('2026-00-10')).toBe(false);
    // 윤년 경계
    expect(isValidYmd('2024-02-29')).toBe(true);
    expect(isValidYmd('2026-02-29')).toBe(false);
  });
});

describe('날짜 산술 (diffDaysYmd·addDaysYmd)', () => {
  it('D-day 일수 차를 계산한다', () => {
    expect(diffDaysYmd('2026-07-20', '2026-07-17')).toBe(3);
    expect(diffDaysYmd('2026-07-17', '2026-07-17')).toBe(0);
    expect(diffDaysYmd('2026-08-01', '2026-07-17')).toBe(15);
  });

  it('월·연 경계를 넘는 덧셈이 정확하다', () => {
    expect(addDaysYmd('2026-07-17', 90)).toBe('2026-10-15');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('deriveUpcomingEvents (단건)', () => {
  it('배당(확대·축소) → 기준일·지급일을 파생한다', () => {
    for (const eventType of [EventType.DIVIDEND_INCREASE, EventType.DIVIDEND_CUT]) {
      const result = deriveUpcomingEvents(eventType, {
        recordDate: '2026-08-10',
        paymentDate: '2026-09-01',
      });
      expect(result).toEqual([
        { kind: 'DIVIDEND_RECORD', label: '배당 기준일', date: '2026-08-10' },
        { kind: 'DIVIDEND_PAYMENT', label: '배당 지급일', date: '2026-09-01' },
      ]);
    }
  });

  it('유상증자(주주배정·제3자배정) → 청약일·신주 상장예정일을 파생한다', () => {
    for (const eventType of [
      EventType.PAID_IN_CAPITAL_INCREASE,
      EventType.THIRD_PARTY_ALLOTMENT,
    ]) {
      const result = deriveUpcomingEvents(eventType, {
        subscriptionDate: '2026-08-03',
        listingDate: '2026-08-21',
      });
      expect(result.map((r) => r.kind)).toEqual(['SUBSCRIPTION', 'NEW_SHARES_LISTING']);
    }
  });

  it('CB/BW → 만기일, 자사주 → 취득 종료일, 거래정지 → 재개 예정일', () => {
    expect(
      deriveUpcomingEvents(EventType.CB_ISSUANCE, { maturityDate: '2029-07-01' }),
    ).toEqual([{ kind: 'BOND_MATURITY', label: '사채 만기일', date: '2029-07-01' }]);
    expect(
      deriveUpcomingEvents(EventType.BW_ISSUANCE, { maturityDate: '2029-07-01' }),
    ).toHaveLength(1);
    expect(
      deriveUpcomingEvents(EventType.SHARE_BUYBACK, { buybackPeriodEnd: '2026-10-15' }),
    ).toEqual([{ kind: 'BUYBACK_END', label: '자사주 취득 종료일', date: '2026-10-15' }]);
    expect(
      deriveUpcomingEvents(EventType.TRADING_SUSPENSION, {
        expectedResumeDate: '2026-07-25',
      }),
    ).toEqual([{ kind: 'TRADING_RESUME', label: '거래재개 예정일', date: '2026-07-25' }]);
  });

  it('결측·형식 불일치 날짜는 제외한다 — 발명 금지', () => {
    expect(deriveUpcomingEvents(EventType.DIVIDEND_INCREASE, {})).toEqual([]);
    expect(
      deriveUpcomingEvents(EventType.DIVIDEND_INCREASE, {
        recordDate: null,
        paymentDate: '미정',
      }),
    ).toEqual([]);
    expect(
      deriveUpcomingEvents(EventType.PAID_IN_CAPITAL_INCREASE, {
        subscriptionDate: '2026-08-03',
        listingDate: '20260821', // 비정규 형식 → 해당 필드만 제외
      }),
    ).toEqual([{ kind: 'SUBSCRIPTION', label: '유상증자 청약일', date: '2026-08-03' }]);
  });

  it('매핑에 없는 eventType·비객체 extractedData → 빈 배열', () => {
    expect(deriveUpcomingEvents(EventType.LAWSUIT, { recordDate: '2026-08-10' })).toEqual([]);
    expect(deriveUpcomingEvents(EventType.DIVIDEND_INCREASE, null)).toEqual([]);
    expect(deriveUpcomingEvents(EventType.DIVIDEND_INCREASE, 'not-an-object')).toEqual([]);
  });

  it('라벨 SSOT와 대상 eventType 집합이 정합하다', () => {
    expect(Object.keys(UPCOMING_EVENT_LABELS)).toHaveLength(7);
    expect(UPCOMING_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        EventType.DIVIDEND_INCREASE,
        EventType.DIVIDEND_CUT,
        EventType.PAID_IN_CAPITAL_INCREASE,
        EventType.THIRD_PARTY_ALLOTMENT,
        EventType.CB_ISSUANCE,
        EventType.BW_ISSUANCE,
        EventType.SHARE_BUYBACK,
        EventType.TRADING_SUSPENSION,
      ]),
    );
    expect(UPCOMING_EVENT_TYPES).toHaveLength(8);
  });
});

describe('deriveUpcomingEventsFromRows (윈도·supersede·dedup·정렬)', () => {
  const row = (over: Partial<UpcomingEventSourceRow>): UpcomingEventSourceRow => ({
    rcpNo: '20260701000001',
    corpCode: '00126380',
    eventType: EventType.DIVIDEND_INCREASE,
    extractedData: { recordDate: '2026-08-10' },
    isAmendment: false,
    originalRcpNo: null,
    ...over,
  });

  const WINDOW = { fromDate: '2026-07-17', toDate: '2026-10-15' };

  it('윈도 밖(과거·초과 미래) 날짜는 제외한다', () => {
    const rows = [
      row({ rcpNo: 'r1', extractedData: { recordDate: '2026-07-16' } }), // 과거
      row({ rcpNo: 'r2', extractedData: { recordDate: '2026-07-17' } }), // 오늘(포함)
      row({ rcpNo: 'r3', extractedData: { recordDate: '2026-10-16' } }), // 윈도 초과
      row({
        rcpNo: 'r4',
        eventType: EventType.CB_ISSUANCE,
        extractedData: { maturityDate: '2029-07-01' }, // 장기 만기 — 윈도 초과
      }),
    ];
    const result = deriveUpcomingEventsFromRows(rows, WINDOW);
    expect(result.map((r) => r.row.rcpNo)).toEqual(['r2']);
  });

  it('정정공시가 지목한 원공시 이벤트를 제외한다 (supersede)', () => {
    const rows = [
      row({ rcpNo: 'orig', extractedData: { recordDate: '2026-08-10' } }),
      row({
        rcpNo: 'amend',
        isAmendment: true,
        originalRcpNo: 'orig',
        extractedData: { recordDate: '2026-08-20' },
      }),
    ];
    const result = deriveUpcomingEventsFromRows(rows, WINDOW);
    expect(result).toHaveLength(1);
    expect(result[0].row.rcpNo).toBe('amend');
    expect(result[0].date).toBe('2026-08-20');
  });

  it('동일 (기업, 종류, 날짜)는 최신 접수번호 1건만 남긴다 (dedup)', () => {
    const rows = [
      row({ rcpNo: '20260701000001' }),
      row({ rcpNo: '20260702000009' }), // 같은 배당기준일 재공시 → 최신만
    ];
    const result = deriveUpcomingEventsFromRows(rows, WINDOW);
    expect(result).toHaveLength(1);
    expect(result[0].row.rcpNo).toBe('20260702000009');
  });

  it('날짜가 다르면 별개 이벤트로 모두 유지한다 (병행 이벤트 실재)', () => {
    const rows = [
      row({
        rcpNo: 'cb1',
        eventType: EventType.CB_ISSUANCE,
        extractedData: { maturityDate: '2026-08-01' },
      }),
      row({
        rcpNo: 'cb2',
        eventType: EventType.CB_ISSUANCE,
        extractedData: { maturityDate: '2026-09-01' },
      }),
    ];
    expect(deriveUpcomingEventsFromRows(rows, WINDOW)).toHaveLength(2);
  });

  it('date asc → corpCode asc 로 결정론 정렬한다', () => {
    const rows = [
      row({ rcpNo: 'b', corpCode: '00000002', extractedData: { recordDate: '2026-09-01' } }),
      row({ rcpNo: 'a', corpCode: '00000001', extractedData: { recordDate: '2026-08-01' } }),
      row({ rcpNo: 'c', corpCode: '00000001', extractedData: { recordDate: '2026-09-01' } }),
    ];
    const result = deriveUpcomingEventsFromRows(rows, WINDOW);
    expect(result.map((r) => r.row.rcpNo)).toEqual(['a', 'c', 'b']);
  });
});
