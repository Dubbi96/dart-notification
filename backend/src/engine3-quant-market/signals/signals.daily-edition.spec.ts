/**
 * DAR-505: 일일 에디션 API 단위테스트.
 *
 * 수용기준 커버:
 * - KST 자정 경계(23:5x UTC) — 자정 UTC 직전/직후 신호가 올바른 KST 날짜 범위에 포함
 * - 주말/공휴일 → emptyReason=CLOSED
 * - 미래 날짜 → emptyReason=FUTURE
 * - 오늘 신호 없음(19:15 KST 이전) → emptyReason=PENDING
 * - 오늘 신호 없음(19:15 KST 이후) → emptyReason=QUIET
 * - 시스템 최초 신호 이전 날짜 → emptyReason=COLD_START
 * - 과거 거래일 신호 없음 → emptyReason=QUIET
 * - 동점 tie-break(buyScore desc→createdAt desc→id desc) — findByCreatedRange orderBy
 * - prevEditionDate/nextEditionDate 산출
 * - findDailyEditions bigint COUNT→number 파싱
 */

import { Test, TestingModule } from '@nestjs/testing';
import { SignalGrade } from '@prisma/client';
import { SignalsService } from './signals.service';
import { PrismaService } from '../../prisma/prisma.service';

// 실제 DB 없이 kstDateToUtcRange 로직을 검증하기 위한 헬퍼
function kstDateToUtcRange(ymd: string): { gteUtc: Date; ltUtc: Date } {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const gteMs = Date.UTC(y, m - 1, d) - 9 * 3600 * 1000;
  return { gteUtc: new Date(gteMs), ltUtc: new Date(gteMs + 86_400_000) };
}

// ─── 순수 함수 단위 테스트 ────────────────────────────────────────────────────

describe('kstDateToUtcRange — KST 자정 경계 계산', () => {
  it('20260716 KST 00:00 = UTC 20260715 15:00:00', () => {
    const { gteUtc } = kstDateToUtcRange('20260716');
    expect(gteUtc.toISOString()).toBe('2026-07-15T15:00:00.000Z');
  });

  it('20260716 KST 24:00 = 20260716 UTC 15:00:00 (ltUtc)', () => {
    const { ltUtc } = kstDateToUtcRange('20260716');
    expect(ltUtc.toISOString()).toBe('2026-07-16T15:00:00.000Z');
  });

  it('KST 23:59:59 UTC (=UTC 14:59:59 당일) 는 해당 KST 날짜 창 안에 포함', () => {
    const { gteUtc, ltUtc } = kstDateToUtcRange('20260716');
    // KST 20260716 23:59:59 = UTC 20260716 14:59:59
    const signalAtKstEndOfDay = new Date('2026-07-16T14:59:59.000Z');
    expect(signalAtKstEndOfDay >= gteUtc).toBe(true);
    expect(signalAtKstEndOfDay < ltUtc).toBe(true);
  });

  it('KST 자정 직전(UTC 23:59:59 전날) 신호는 이전 KST 날짜 창에 귀속', () => {
    // KST 20260715 23:59:59 = UTC 20260715 14:59:59
    const { gteUtc: gte16, ltUtc: lt16 } = kstDateToUtcRange('20260716');
    const { ltUtc: lt15 } = kstDateToUtcRange('20260715');
    const signalAt = new Date('2026-07-15T14:59:59.000Z');
    // 20260716 창 밖
    expect(signalAt < gte16).toBe(true);
    // 20260715 창 안
    expect(signalAt < lt15).toBe(true);
  });
});

// ─── SignalsService.findDailyEdition 통합 단위 테스트 (mock PrismaService) ────

const BASE_SIGNAL = {
  id: 'sig_1',
  rcpNo: '20260716000001',
  corpCode: '00126380',
  stockCode: '005930',
  eventType: 'SUPPLY_CONTRACT',
  persona: 'GROWTH',
  buyScore: 72,
  signal: SignalGrade.BUY_CANDIDATE,
  calibratedConfidence: null,
  scoreBreakdown: { disclosureEvent: 20 },
  riskPenalty: 0,
  entryConditionMet: [],
  entryConditionUnmet: [],
  entryReady: true,
  riskFactors: [],
  signalSummary: null,
  blockedReason: null,
  suppressionReason: null,
  validUntil: null,
  isNotified: false,
  notifiedAt: null,
  createdAt: new Date('2026-07-15T15:30:00.000Z'), // KST 20260716 00:30
  updatedAt: new Date('2026-07-15T15:30:00.000Z'),
  company: { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930' },
  disclosure: { rcpDt: '20260716' },
};

describe('SignalsService — findDailyEdition', () => {
  let service: SignalsService;
  let prisma: {
    tradingSignal: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
    };
    eventStudyResult: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  // 오늘 날짜를 고정(KST 20260716 = UTC 20260715 15:00 이후)
  const TODAY_KST = '20260716';
  // 테스트용 "현재 시각" — KST 20260716 20:00 (19:15 이후 → QUIET)
  const NOW_KST_20H = new Date('2026-07-16T11:00:00.000Z').getTime(); // UTC 11:00 = KST 20:00

  beforeEach(async () => {
    prisma = {
      tradingSignal: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      eventStudyResult: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);

    // Date.now() 모킹 — KST 20260716
    jest.spyOn(Date, 'now').mockReturnValue(NOW_KST_20H);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── emptyReason 케이스 ────────────────────────────────────────────────────

  it('미래 날짜 → emptyReason=FUTURE', async () => {
    const result = await service.findDailyEdition('20260901');
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('FUTURE');
  });

  it('주말(토) → emptyReason=CLOSED', async () => {
    // 2026-07-18은 토요일
    const result = await service.findDailyEdition('20260718');
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('CLOSED');
  });

  it('공휴일(설날 연휴 20260217) → emptyReason=CLOSED', async () => {
    const result = await service.findDailyEdition('20260217');
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('CLOSED');
  });

  it('오늘(TODAY_KST) + 신호 없음 + 19:15 이후 → emptyReason=QUIET', async () => {
    // NOW_KST_20H = KST 20:00 (>19:15)
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('QUIET');
  });

  it('오늘 + 신호 없음 + 19:15 이전 → emptyReason=PENDING', async () => {
    // KST 18:00 (UTC 09:00) — 19:15 이전
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-16T09:00:00.000Z').getTime());
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('PENDING');
  });

  it('과거 거래일 + 신호 없음 + firstSig 있음 → emptyReason=QUIET', async () => {
    // firstSig는 20260701 KST 신호 → 20260701 < 20260710 이므로 COLD_START 아님
    prisma.tradingSignal.findFirst.mockImplementation((args: { orderBy?: { createdAt?: string } }) => {
      if (args?.orderBy?.createdAt === 'asc') {
        // 시스템 최초 신호: KST 20260701
        return Promise.resolve({ createdAt: new Date('2026-07-01T00:00:00.000Z') });
      }
      return Promise.resolve(null);
    });
    const result = await service.findDailyEdition('20260710'); // 과거 거래일
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('QUIET');
  });

  it('시스템 최초 신호보다 이전 날짜 → emptyReason=COLD_START', async () => {
    // 시스템 최초 신호: KST 20260715 (UTC 20260714T15:00)
    prisma.tradingSignal.findFirst.mockImplementation((args: { orderBy?: { createdAt?: string } }) => {
      if (args?.orderBy?.createdAt === 'asc') {
        return Promise.resolve({ createdAt: new Date('2026-07-14T15:00:00.000Z') }); // KST 20260715
      }
      return Promise.resolve(null);
    });
    // 20260710은 KST 20260715 이전 → COLD_START
    const result = await service.findDailyEdition('20260710');
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('COLD_START');
  });

  // ─── 신호 존재 케이스 ─────────────────────────────────────────────────────

  it('신호 있으면 isEmpty=false, emptyReason=undefined', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([BASE_SIGNAL]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.isEmpty).toBe(false);
    expect(result.meta.emptyReason).toBeUndefined();
    expect(result.items).toHaveLength(1);
  });

  it('응답 item에 rcpDt 포함', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([BASE_SIGNAL]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.items[0].rcpDt).toBe('20260716');
  });

  it('isToday=true 이면 meta.isToday=true', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([BASE_SIGNAL]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.isToday).toBe(true);
  });

  it('과거 날짜이면 isToday=false', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([BASE_SIGNAL]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    const result = await service.findDailyEdition('20260715');
    expect(result.meta.isToday).toBe(false);
  });

  it('신호 1건이면 personaCount=1, otherPersonas=[]', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([BASE_SIGNAL]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.items[0].personaCount).toBe(1);
    expect(result.items[0].otherPersonas).toEqual([]);
  });

  // ─── DAR-553: corpCode당 대표 1건 dedup ────────────────────────────────────

  function signalFixture(overrides: Partial<typeof BASE_SIGNAL>): typeof BASE_SIGNAL {
    return { ...BASE_SIGNAL, ...overrides };
  }

  it('같은 corpCode·다른 persona 2건 → 에디션 1카드로 dedup + personaCount=2', async () => {
    const high = signalFixture({ id: 'sig_high', persona: 'GROWTH', buyScore: 90 });
    const low = signalFixture({ id: 'sig_low', persona: 'VALUE', buyScore: 70 });
    // Prisma orderBy(buyScore desc)를 흉내: 서비스가 이미 정렬된 결과를 받는다고 가정.
    prisma.tradingSignal.findMany.mockResolvedValue([high, low]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);

    const result = await service.findDailyEdition(TODAY_KST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('sig_high'); // 최고 buyScore가 대표
    expect(result.items[0].buyScore).toBe(90);
    expect(result.items[0].personaCount).toBe(2);
    expect(result.items[0].otherPersonas).toEqual(['VALUE']);
  });

  it('같은 corpCode·동일 buyScore 동점 → tie-break(createdAt desc)가 대표를 결정', async () => {
    const older = signalFixture({
      id: 'sig_older',
      persona: 'GROWTH',
      buyScore: 80,
      createdAt: new Date('2026-07-15T15:10:00.000Z'),
    });
    const newer = signalFixture({
      id: 'sig_newer',
      persona: 'MOMENTUM',
      buyScore: 80,
      createdAt: new Date('2026-07-15T15:20:00.000Z'),
    });
    // findMany 는 orderBy(buyScore desc, createdAt desc, id desc) 결과를 반환하므로 newer 가 먼저 온다.
    prisma.tradingSignal.findMany.mockResolvedValue([newer, older]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);

    const result = await service.findDailyEdition(TODAY_KST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('sig_newer');
    expect(result.items[0].otherPersonas).toEqual(['GROWTH']);
  });

  it('서로 다른 corpCode 2건 → dedup 없이 2카드 유지(과도 병합 금지)', async () => {
    const corpA = signalFixture({ id: 'sig_a', corpCode: 'CORP_A', buyScore: 90 });
    const corpB = signalFixture({ id: 'sig_b', corpCode: 'CORP_B', buyScore: 80 });
    prisma.tradingSignal.findMany.mockResolvedValue([corpA, corpB]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);

    const result = await service.findDailyEdition(TODAY_KST);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.corpCode)).toEqual(['CORP_A', 'CORP_B']);
    expect(result.items.every((i) => i.personaCount === 1)).toBe(true);
  });

  it('DAR-553 계약: 홈 요약 상위 2건(top-2)이 자동으로 서로 다른 종목이 된다', async () => {
    // 같은 corp(A)가 페르소나 2개(90, 85)로 1·2위를 모두 점유하던 회귀 시나리오.
    // dedup 전이었다면 top-2 = [A(90), A(85)] — 홈 요약이 같은 종목을 두 번 보여줬을 것.
    const corpAHigh = signalFixture({ id: 'sig_a_high', corpCode: 'CORP_A', persona: 'GROWTH', buyScore: 90 });
    const corpALow = signalFixture({ id: 'sig_a_low', corpCode: 'CORP_A', persona: 'VALUE', buyScore: 85 });
    const corpB = signalFixture({ id: 'sig_b', corpCode: 'CORP_B', persona: 'MOMENTUM', buyScore: 80 });
    prisma.tradingSignal.findMany.mockResolvedValue([corpAHigh, corpALow, corpB]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);

    const result = await service.findDailyEdition(TODAY_KST);
    const top2 = result.items.slice(0, 2); // HomeSignalPreview.MAX_PREVIEW=2 와 동일 슬라이스

    expect(top2).toHaveLength(2);
    expect(new Set(top2.map((i) => i.corpCode)).size).toBe(2); // 서로 다른 종목
    expect(top2[0]).toMatchObject({ corpCode: 'CORP_A', buyScore: 90, personaCount: 2 });
    expect(top2[1]).toMatchObject({ corpCode: 'CORP_B', buyScore: 80 });
  });

  // ─── prevEditionDate / nextEditionDate ────────────────────────────────────

  it('prevSig 있으면 prevEditionDate가 KST 날짜 문자열로 반환', async () => {
    // prevSig: KST 20260714 = UTC 20260713T15:xx
    prisma.tradingSignal.findFirst.mockImplementation((args: {
      orderBy?: { createdAt?: string };
      where?: { createdAt?: { lt?: Date; gte?: Date } };
    }) => {
      if (args?.where?.createdAt?.lt) {
        // prevSig 쿼리
        return Promise.resolve({ createdAt: new Date('2026-07-13T15:30:00.000Z') }); // KST 20260714
      }
      if (args?.where?.createdAt?.gte) {
        // nextSig 쿼리
        return Promise.resolve(null);
      }
      if (args?.orderBy?.createdAt === 'asc') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.prevEditionDate).toBe('20260714');
  });

  it('nextSig 없으면 nextEditionDate=undefined', async () => {
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.nextEditionDate).toBeUndefined();
  });

  // ─── tie-break: buyScore desc→createdAt desc→id desc ─────────────────────

  it('findMany orderBy는 buyScore desc → createdAt desc → id desc', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    await service.findDailyEdition(TODAY_KST);
    const call = prisma.tradingSignal.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([
      { buyScore: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  // ─── createdAt 범위 파라미터 ──────────────────────────────────────────────

  it('KST 20260716 창 → gteUtc=20260715T15:00Z, ltUtc=20260716T15:00Z', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    await service.findDailyEdition(TODAY_KST);
    const call = prisma.tradingSignal.findMany.mock.calls[0][0];
    expect(call.where.createdAt).toEqual({
      gte: new Date('2026-07-15T15:00:00.000Z'),
      lt: new Date('2026-07-16T15:00:00.000Z'),
    });
  });

  // ─── DAR-551: 빈 에디션 폴백 브리핑(meta.fallbackBriefing) ──────────────────

  const BRIEFING_ROWS = [
    {
      rcpNo: '20260716000009',
      corpName: '카카오',
      reportName: '단일판매·공급계약 체결',
      eventType: 'SUPPLY_CONTRACT',
      summaryText: '1,200억 규모 공급계약을 체결했다.',
    },
    {
      rcpNo: '20260716000003',
      corpName: '네이버',
      reportName: '주주총회 소집결의',
      eventType: null,
      summaryText: null,
    },
  ];

  it('빈 에디션(QUIET) + 주요 공시 존재 → meta.fallbackBriefing 매핑 노출(판단 count 불변)', async () => {
    prisma.$queryRaw.mockResolvedValue(BRIEFING_ROWS);
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.emptyReason).toBe('QUIET');
    // ★정직 불변식: 판단(items) 은 여전히 0 — 브리핑은 판단이 아니다.
    expect(result.items).toHaveLength(0);
    // 브리핑은 meta 로 분리 노출.
    expect(result.meta.fallbackBriefing).toHaveLength(2);
    expect(result.meta.fallbackBriefing?.[0]).toEqual({
      rcpNo: '20260716000009',
      corpName: '카카오',
      eventLabel: '공급계약',
      summaryLine: '1,200억 규모 공급계약을 체결했다.',
      summarySource: 'AI',
    });
    expect(result.meta.fallbackBriefing?.[1]).toEqual({
      rcpNo: '20260716000003',
      corpName: '네이버',
      eventLabel: '기타 공시',
      summaryLine: '주주총회 소집결의',
      summarySource: 'TITLE',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('빈 에디션 + 주요 공시 없음 → meta.fallbackBriefing=[] (빈 배열)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.fallbackBriefing).toEqual([]);
  });

  it('비빈 에디션(판단 존재) → fallbackBriefing 없음 + 브리핑 쿼리 미호출', async () => {
    prisma.tradingSignal.findMany.mockResolvedValue([BASE_SIGNAL]);
    prisma.eventStudyResult.findMany.mockResolvedValue([]);
    const result = await service.findDailyEdition(TODAY_KST);
    expect(result.meta.isEmpty).toBe(false);
    expect(result.meta.fallbackBriefing).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('FUTURE → 브리핑 미조회(fallbackBriefing undefined)', async () => {
    const result = await service.findDailyEdition('20260901');
    expect(result.meta.emptyReason).toBe('FUTURE');
    expect(result.meta.fallbackBriefing).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('CLOSED(주말) → 브리핑 미조회(fallbackBriefing undefined)', async () => {
    const result = await service.findDailyEdition('20260718'); // 토요일
    expect(result.meta.emptyReason).toBe('CLOSED');
    expect(result.meta.fallbackBriefing).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

// ─── findDailyEditions: bigint COUNT → number 파싱 ──────────────────────────

describe('SignalsService — findDailyEditions', () => {
  let service: SignalsService;
  let prisma: {
    tradingSignal: { findMany: jest.Mock; findFirst: jest.Mock; count: jest.Mock };
    eventStudyResult: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      tradingSignal: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      eventStudyResult: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-16T11:00:00.000Z').getTime());
  });

  afterEach(() => jest.restoreAllMocks());

  it('$queryRaw bigint COUNT를 number로 파싱', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        date: '20260716',
        count: BigInt(5),
        strongBuyCount: BigInt(2),
        headlineCorpName: '삼성전자',
        topGradeRaw: SignalGrade.STRONG_BUY_CANDIDATE,
      },
    ]);
    const result = await service.findDailyEditions();
    // date 는 compact 'YYYYMMDD'(SQL to_char) — todayDate·before 커서와 동일 형식.
    expect(result.items[0].date).toBe('20260716');
    expect(typeof result.items[0].count).toBe('number');
    expect(result.items[0].count).toBe(5);
    expect(typeof result.items[0].strongBuyCount).toBe('number');
    expect(result.items[0].strongBuyCount).toBe(2);
  });

  it('topGradeRaw(STRONG_BUY_CANDIDATE) → topGrade=STRONG_BUY', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        date: '20260716',
        count: BigInt(3),
        strongBuyCount: BigInt(3),
        headlineCorpName: '삼성전자',
        topGradeRaw: SignalGrade.STRONG_BUY_CANDIDATE,
      },
    ]);
    const result = await service.findDailyEditions();
    expect(result.items[0].topGrade).toBe('STRONG_BUY');
  });

  it('결과 없으면 hasMore=false, nextCursor=undefined', async () => {
    const result = await service.findDailyEditions();
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextCursor).toBeUndefined();
  });

  it('결과 수 = limit 이면 hasMore=true, nextCursor=마지막 날짜', async () => {
    const limit = 2;
    prisma.$queryRaw.mockResolvedValue([
      { date: '20260716', count: BigInt(1), strongBuyCount: BigInt(0), headlineCorpName: null, topGradeRaw: SignalGrade.BUY_CANDIDATE },
      { date: '20260715', count: BigInt(1), strongBuyCount: BigInt(0), headlineCorpName: null, topGradeRaw: SignalGrade.BUY_CANDIDATE },
    ]);
    const result = await service.findDailyEditions(undefined, limit);
    expect(result.meta.hasMore).toBe(true);
    // nextCursor 는 compact 'YYYYMMDD' — before 커서(\d{8})로 그대로 왕복 가능해야 한다.
    expect(result.meta.nextCursor).toBe('20260715');
  });

  it('todayHasEdition: count>0이면 true', async () => {
    prisma.tradingSignal.count.mockResolvedValue(3);
    const result = await service.findDailyEditions();
    expect(result.meta.todayHasEdition).toBe(true);
  });

  it('todayDate는 현재 KST 날짜', async () => {
    const result = await service.findDailyEditions();
    expect(result.meta.todayDate).toBe('20260716');
  });
});
