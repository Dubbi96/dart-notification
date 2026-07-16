import { getSignalDateStatus, ATTRIBUTION_DELAY_TRADING_DAYS } from '@utils/signalFreshness';

// 신호 날짜 배지 상태 파생(getSignalDateStatus) 회귀 가드 (DAR-506).
// now 주입으로 결정론 — 디바이스 타임존·Date.now() 비의존. rcpDt='YYYYMMDD'(KST 달력일),
// createdAt=ISO(UTC). KST(+9h) 달력일 기준 절대일/상대표기/지연·만료 상태를 검증한다.

// 헬퍼: KST 정오(=UTC 03:00)의 epoch — 특정 KST 달력일을 결정론적으로 지정.
const kstNoon = (isoDate: string) => new Date(`${isoDate}T03:00:00Z`).getTime();

describe('getSignalDateStatus — 절대일 상시 병기', () => {
  it('공시 접수일(rcpDt) 기준 오늘 → dateText M/D + relativeText 오늘 + current', () => {
    const now = kstNoon('2026-06-24');
    const s = getSignalDateStatus({ rcpDt: '20260624', createdAt: '2026-06-24T03:00:00Z' }, now);
    expect(s.show).toBe(true);
    expect(s.source).toBe('disclosure');
    expect(s.dateText).toBe('6/24');
    expect(s.relativeText).toBe('오늘');
    expect(s.kind).toBe('current');
    expect(s.tone).toBe('muted');
    expect(s.label).toBe('공시 6/24 · 오늘');
    expect(s.dateA11yText).toBe('6월 24일');
    expect(s.accessibleText).toBe('공시 접수 6월 24일, 오늘');
  });

  it('공시 접수일이 어제 → relativeText 어제(절대일 병기)', () => {
    const now = kstNoon('2026-06-24');
    const s = getSignalDateStatus({ rcpDt: '20260623', createdAt: '2026-06-23T03:00:00Z' }, now);
    expect(s.dateText).toBe('6/23');
    expect(s.relativeText).toBe('어제');
    expect(s.kind).toBe('current');
    expect(s.label).toBe('공시 6/23 · 어제');
  });

  it('귀속 근거(rcpDt·rcpNo·createdAt) 전무 → show=false(억지 표기 금지)', () => {
    expect(getSignalDateStatus({}).show).toBe(false);
    expect(getSignalDateStatus({ createdAt: null }).show).toBe(false);
    expect(getSignalDateStatus({ createdAt: 'not-a-date' }).show).toBe(false);
  });
});

describe('getSignalDateStatus — 지연 반영(귀속일 정직화)', () => {
  it('접수일→발행일 거래일 간극 2(월→수) → delayed', () => {
    const now = kstNoon('2026-06-17'); // 수
    const s = getSignalDateStatus(
      { rcpDt: '20260615', createdAt: '2026-06-17T03:00:00Z' }, // 월 접수 · 수 발행
      now,
    );
    expect(s.kind).toBe('delayed');
    expect(s.tone).toBe('warn');
    expect(s.statusLabel).toBe('지연 반영');
    expect(s.dateText).toBe('6/15'); // 절대일은 공시 접수일
    expect(s.label).toBe('공시 6/15 · 지연 반영');
    expect(s.accessibleText).toBe('공시 접수 6월 15일, 그제 · 지연 반영');
  });

  it('간극 1거래일(월→화) → 지연 아님(current)', () => {
    const now = kstNoon('2026-06-16');
    const s = getSignalDateStatus({ rcpDt: '20260615', createdAt: '2026-06-16T03:00:00Z' }, now);
    expect(s.kind).toBe('current');
    expect(s.relativeText).toBe('어제');
  });

  it('주말 간극은 지연으로 오분류하지 않음(금→월 = 1거래일)', () => {
    const now = kstNoon('2026-06-22'); // 월
    const s = getSignalDateStatus(
      { rcpDt: '20260619', createdAt: '2026-06-22T03:00:00Z' }, // 금 접수 · 월 발행
      now,
    );
    expect(s.kind).toBe('current');
  });

  it('주말 넘어 2거래일(금→화) → delayed', () => {
    const now = kstNoon('2026-06-23'); // 화
    const s = getSignalDateStatus(
      { rcpDt: '20260619', createdAt: '2026-06-23T03:00:00Z' }, // 금 접수 · 화 발행
      now,
    );
    expect(s.kind).toBe('delayed');
  });

  it('임계 상수는 2거래일', () => {
    expect(ATTRIBUTION_DELAY_TRADING_DAYS).toBe(2);
  });
});

describe('getSignalDateStatus — 만료(최우선)', () => {
  it('now ≥ expiresAt → expired(지연보다 우선)', () => {
    const now = kstNoon('2026-06-24');
    const s = getSignalDateStatus(
      {
        rcpDt: '20260615', // 월 접수(발행 수 → 원래라면 delayed)
        createdAt: '2026-06-17T03:00:00Z',
        expiresAt: '2026-06-20T00:00:00Z', // now 이전 → 만료
      },
      now,
    );
    expect(s.kind).toBe('expired');
    expect(s.tone).toBe('alert');
    expect(s.statusLabel).toBe('만료');
    expect(s.label).toBe('공시 6/15 · 만료');
    expect(s.accessibleText).toBe('공시 접수 6월 15일, 만료 · 재평가 필요');
  });

  it('미래 expiresAt → 만료 아님', () => {
    const now = kstNoon('2026-06-17');
    const s = getSignalDateStatus(
      {
        rcpDt: '20260616',
        createdAt: '2026-06-16T03:00:00Z',
        expiresAt: '2026-06-30T00:00:00Z',
      },
      now,
    );
    expect(s.kind).not.toBe('expired');
  });
});

describe('getSignalDateStatus — 출처 폴백/우선순위', () => {
  it('공시 없으면 createdAt 폴백(source=signal, 신호 라벨)', () => {
    const now = kstNoon('2026-06-17');
    const s = getSignalDateStatus({ createdAt: '2026-06-17T03:00:00Z' }, now);
    expect(s.show).toBe(true);
    expect(s.source).toBe('signal');
    expect(s.dateText).toBe('6/17');
    expect(s.label).toBe('신호 6/17 · 오늘');
    expect(s.accessibleText).toBe('신호 생성 6월 17일, 오늘');
  });

  it('rcpNo(14자리) 앞 8자리를 접수일로 사용(rcpDt 폴백)', () => {
    const now = kstNoon('2026-06-17');
    const s = getSignalDateStatus(
      { relatedDisclosureRcpNo: '20260615000123', createdAt: '2026-06-17T03:00:00Z' },
      now,
    );
    expect(s.source).toBe('disclosure');
    expect(s.dateText).toBe('6/15');
  });

  it('rcpDt 가 rcpNo 보다 우선', () => {
    const now = kstNoon('2026-06-18');
    const s = getSignalDateStatus(
      {
        rcpDt: '20260618',
        relatedDisclosureRcpNo: '20260615000001',
        createdAt: '2026-06-18T03:00:00Z',
      },
      now,
    );
    expect(s.dateText).toBe('6/18');
    expect(s.kind).toBe('current');
  });
});

describe('getSignalDateStatus — 경계', () => {
  it('KST 자정 경계: createdAt UTC 15:00 → 다음 KST 달력일', () => {
    // 2026-06-16T15:00Z = KST 2026-06-17 00:00. now = KST 06-17.
    const now = kstNoon('2026-06-17');
    const s = getSignalDateStatus({ createdAt: '2026-06-16T15:00:00.000Z' }, now);
    expect(s.dateText).toBe('6/17');
    expect(s.relativeText).toBe('오늘');
  });

  it('다른 해면 YYYY/M/D 절대일', () => {
    const now = kstNoon('2026-01-05');
    const s = getSignalDateStatus({ rcpDt: '20251230', createdAt: '2025-12-30T03:00:00Z' }, now);
    expect(s.dateText).toBe('2025/12/30');
  });

  it('미래 접수일(클럭 스큐) → 오늘으로 정직화(지연 아님)', () => {
    const now = kstNoon('2026-06-17');
    const s = getSignalDateStatus({ rcpDt: '20260624', createdAt: '2026-06-24T03:00:00Z' }, now);
    expect(s.relativeText).toBe('오늘');
    expect(s.kind).toBe('current');
  });
});
