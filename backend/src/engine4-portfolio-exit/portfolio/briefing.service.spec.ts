/**
 * briefing.service.spec.ts (W14) — 오늘의 브리핑 조립 검증.
 * - 섹션별 0건 억제(null)·전 섹션 0건 → 브리핑 null
 * - 기준 시각 freshness 정직 표기(asOf·dateKst — 주입 now 기준 KST)
 * - 손익 집계 위임 경계: 서비스는 스냅샷 조회만, 산식은 briefing.util.aggregateDailyPnl
 * - 이벤트: 당일(KST)·백필 제외 필터, 캐시 요약 재사용(신규 AI 호출 0), POSITION/WATCHLIST 출처
 * - 점검: 당일 ExitSignal(HOLD 제외)·thesis VIOLATED/EXPIRED 큐레이션, 리스크는 PortfolioService 위임
 */

import { BriefingService } from './briefing.service';
import * as briefingUtil from './briefing.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PortfolioService, PortfolioRiskSnapshotView } from './portfolio.service';

// 2026-07-16 KST 오후 2시(UTC 05:00) — 결정론 기준 시각.
const NOW = new Date('2026-07-16T05:00:00.000Z');

interface PrismaMockSeed {
  positions?: unknown[];
  watchItems?: { corpCode: string }[];
  events?: unknown[];
  analyses?: unknown[];
  snapshotDates?: { latest: string | null; prev: string | null };
  snapshotRows?: { latest: unknown[]; prev: unknown[] };
  exitSignals?: unknown[];
}

function makePrismaMock(seed: PrismaMockSeed) {
  const dates = seed.snapshotDates ?? { latest: null, prev: null };
  const rows = seed.snapshotRows ?? { latest: [], prev: [] };

  return {
    position: { findMany: jest.fn().mockResolvedValue(seed.positions ?? []) },
    watchList: { findMany: jest.fn().mockResolvedValue(seed.watchItems ?? []) },
    disclosureEvent: { findMany: jest.fn().mockResolvedValue(seed.events ?? []) },
    disclosureAnalysis: { findMany: jest.fn().mockResolvedValue(seed.analyses ?? []) },
    positionDailySnapshot: {
      // 1호출: 최신 스냅샷일, 2호출: 직전 스냅샷일.
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(dates.latest ? { snapshotDate: dates.latest } : null)
        .mockResolvedValueOnce(dates.prev ? { snapshotDate: dates.prev } : null),
      // 1호출: 최신일 행들, 2호출: 직전일 행들(직전일 없으면 미호출).
      findMany: jest
        .fn()
        .mockResolvedValueOnce(rows.latest)
        .mockResolvedValueOnce(rows.prev),
    },
    exitSignal: { findMany: jest.fn().mockResolvedValue(seed.exitSignals ?? []) },
  } as unknown as PrismaService;
}

function makePortfolioServiceMock(risk: PortfolioRiskSnapshotView | null) {
  return {
    findLatestRiskSnapshot: jest.fn().mockResolvedValue(risk),
  } as unknown as PortfolioService;
}

const POSITION_ROW = {
  id: 'pos-1',
  corpCode: 'C001',
  portfolio: { id: 'pf-1' },
  company: { corpName: '삼성전자' },
  positionThesis: { status: 'ACTIVE' },
};

describe('BriefingService — 조립·억제·기준 시각', () => {
  afterEach(() => jest.restoreAllMocks());

  it('전 섹션 0건이면 브리핑 자체가 null(빈 껍데기 금지)', async () => {
    const service = new BriefingService(makePrismaMock({}), makePortfolioServiceMock(null));
    await expect(service.buildTodayBriefing('user-1', NOW)).resolves.toBeNull();
  });

  it('한 섹션이라도 있으면 나머지 섹션은 null로 생략하고 기준 시각을 정직 표기한다', async () => {
    const risk = { portfolioId: 'pf-1', riskLevel: 'NORMAL' } as PortfolioRiskSnapshotView;
    const service = new BriefingService(makePrismaMock({}), makePortfolioServiceMock(risk));

    const briefing = await service.buildTodayBriefing('user-1', NOW);

    expect(briefing).not.toBeNull();
    expect(briefing?.events).toBeNull();
    expect(briefing?.dailyPnl).toBeNull();
    expect(briefing?.checks).toBeNull();
    expect(briefing?.risk).toBe(risk);
    // freshness — 주입 now의 ISO 시각 + KST 벽시계 날짜(UTC 05:00 = KST 14:00 같은 날).
    expect(briefing?.asOf).toBe('2026-07-16T05:00:00.000Z');
    expect(briefing?.dateKst).toBe('2026-07-16');
  });

  it('UTC 자정 직전(KST 익일 새벽)에도 dateKst는 KST 거래일이다', async () => {
    // UTC 7/15 16:00 = KST 7/16 01:00 → dateKst 는 7/16 이어야 한다.
    const kstEarly = new Date('2026-07-15T16:00:00.000Z');
    const risk = { portfolioId: 'pf-1' } as PortfolioRiskSnapshotView;
    const service = new BriefingService(makePrismaMock({}), makePortfolioServiceMock(risk));

    const briefing = await service.buildTodayBriefing('user-1', kstEarly);
    expect(briefing?.dateKst).toBe('2026-07-16');
  });
});

describe('BriefingService — 이벤트 섹션(당일·백필 제외·캐시 요약 재사용)', () => {
  it('포지션·관심종목 합집합의 당일 이벤트를 백필 제외로 조회하고 출처를 구분한다', async () => {
    const prisma = makePrismaMock({
      positions: [POSITION_ROW],
      watchItems: [{ corpCode: 'C002' }],
      events: [
        {
          rcpNo: '20260716000002',
          corpCode: 'C002',
          eventType: 'SUPPLY_CONTRACT',
          polarity: 'POSITIVE',
          disclosure: { corpName: '카카오', reportName: '단일판매·공급계약 체결' },
        },
        {
          rcpNo: '20260716000001',
          corpCode: 'C001',
          eventType: 'SHARE_BUYBACK',
          polarity: 'POSITIVE',
          disclosure: { corpName: '삼성전자', reportName: '자기주식 취득 결정' },
        },
      ],
      analyses: [
        {
          rcpNo: '20260716000001',
          resultJson: { summary: '자사주 1조원 취득을 결정했다.' },
        },
      ],
    });
    const service = new BriefingService(prisma, makePortfolioServiceMock(null));

    const briefing = await service.buildTodayBriefing('user-1', NOW);
    const events = briefing?.events;

    expect(events).toHaveLength(2);
    // 출처: 포지션 종목 vs 관심종목.
    expect(events?.find((e) => e.corpCode === 'C001')?.source).toBe('POSITION');
    expect(events?.find((e) => e.corpCode === 'C002')?.source).toBe('WATCHLIST');
    // 캐시된 요약 1줄 재사용(있으면 문자열, 없으면 null 정직 결측).
    expect(events?.find((e) => e.rcpNo === '20260716000001')?.summaryLine).toBe(
      '자사주 1조원 취득을 결정했다.',
    );
    expect(events?.find((e) => e.rcpNo === '20260716000002')?.summaryLine).toBeNull();

    // 쿼리 계약: 당일(KST) rcpDt prefix + isBackfill=false(라이브 표면 백필 불가침).
    const where = (prisma.disclosureEvent.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.corpCode.in).toEqual(expect.arrayContaining(['C001', 'C002']));
    expect(where.disclosure).toEqual({
      rcpDt: { startsWith: '20260716' },
      isBackfill: false,
    });
    // 요약은 summary task 캐시만 조회 — 신규 AI 호출 경로 자체가 없다.
    const analysisWhere = (prisma.disclosureAnalysis.findMany as jest.Mock).mock.calls[0][0].where;
    expect(analysisWhere.task).toBe('summary');
  });

  it('포지션·관심종목이 모두 없으면 이벤트 조회 없이 섹션 null', async () => {
    const prisma = makePrismaMock({});
    const service = new BriefingService(prisma, makePortfolioServiceMock(null));

    await service.buildTodayBriefing('user-1', NOW);
    expect(prisma.disclosureEvent.findMany).not.toHaveBeenCalled();
  });
});

describe('BriefingService — 손익 집계 위임 경계', () => {
  afterEach(() => jest.restoreAllMocks());

  it('서비스는 최신·직전 스냅샷 행 조회만 하고, 산식은 aggregateDailyPnl에 위임한다', async () => {
    const latestRows = [{ positionId: 'pos-1', unrealizedPnl: 1500, positionValue: 11500 }];
    const prevRows = [{ positionId: 'pos-1', unrealizedPnl: 1000, positionValue: 11000 }];
    const prisma = makePrismaMock({
      positions: [POSITION_ROW],
      snapshotDates: { latest: '20260716', prev: '20260715' },
      snapshotRows: { latest: latestRows, prev: prevRows },
    });
    const aggregateSpy = jest.spyOn(briefingUtil, 'aggregateDailyPnl');
    const service = new BriefingService(prisma, makePortfolioServiceMock(null));

    const briefing = await service.buildTodayBriefing('user-1', NOW);

    // 위임 경계: 조회된 행이 그대로 순수 함수에 전달되고, 결과가 섹션에 반영된다.
    expect(aggregateSpy).toHaveBeenCalledWith(latestRows, prevRows);
    expect(briefing?.dailyPnl).toEqual({
      snapshotDate: '20260716', // 데이터 기준일 freshness
      ...briefingUtil.aggregateDailyPnl(latestRows, prevRows),
    });
    expect(briefing?.dailyPnl?.dailyPnl).toBe(500);
  });

  it('직전 스냅샷일이 없으면 빈 직전 행으로 위임한다(당일 첫 스냅샷)', async () => {
    const latestRows = [{ positionId: 'pos-1', unrealizedPnl: 200, positionValue: 10200 }];
    const prisma = makePrismaMock({
      positions: [POSITION_ROW],
      snapshotDates: { latest: '20260716', prev: null },
      snapshotRows: { latest: latestRows, prev: [] },
    });
    const aggregateSpy = jest.spyOn(briefingUtil, 'aggregateDailyPnl');
    const service = new BriefingService(prisma, makePortfolioServiceMock(null));

    const briefing = await service.buildTodayBriefing('user-1', NOW);

    expect(aggregateSpy).toHaveBeenCalledWith(latestRows, []);
    expect(briefing?.dailyPnl?.dailyPnl).toBe(200);
  });

  it('스냅샷이 아예 없으면 손익 섹션 null(0원 위장 금지)', async () => {
    const prisma = makePrismaMock({
      positions: [POSITION_ROW],
      snapshotDates: { latest: null, prev: null },
    });
    const risk = { portfolioId: 'pf-1' } as PortfolioRiskSnapshotView;
    const service = new BriefingService(prisma, makePortfolioServiceMock(risk));

    const briefing = await service.buildTodayBriefing('user-1', NOW);
    expect(briefing?.dailyPnl).toBeNull();
  });
});

describe('BriefingService — 점검 섹션(ExitSignal·thesisStatus)·리스크 위임', () => {
  it('당일 HOLD 아닌 ExitSignal 또는 thesis VIOLATED/EXPIRED만 큐레이션한다', async () => {
    const positions = [
      POSITION_ROW, // ACTIVE + 당일 REDUCE 신호 → 포함
      {
        id: 'pos-2',
        corpCode: 'C002',
        portfolio: { id: 'pf-1' },
        company: { corpName: '카카오' },
        positionThesis: { status: 'INVALIDATED' }, // VIOLATED → 신호 없어도 포함
      },
      {
        id: 'pos-3',
        corpCode: 'C003',
        portfolio: { id: 'pf-1' },
        company: { corpName: 'NAVER' },
        positionThesis: { status: 'ACTIVE' }, // 당일 HOLD 신호뿐 → 제외
      },
    ];
    const prisma = makePrismaMock({
      positions,
      exitSignals: [
        {
          positionId: 'pos-1',
          exitScore: 55,
          exitAction: 'REDUCE',
          checkedAt: new Date('2026-07-16T04:00:00.000Z'),
        },
        {
          positionId: 'pos-3',
          exitScore: 10,
          exitAction: 'HOLD',
          checkedAt: new Date('2026-07-16T04:00:00.000Z'),
        },
      ],
    });
    const service = new BriefingService(prisma, makePortfolioServiceMock(null));

    const briefing = await service.buildTodayBriefing('user-1', NOW);
    const checks = briefing?.checks;

    expect(checks?.map((c) => c.positionId)).toEqual(['pos-2', 'pos-1']); // VIOLATED 최우선
    expect(checks?.[0].thesisStatus).toBe('VIOLATED');
    expect(checks?.[0].reason).toBe('투자 논지 훼손');
    expect(checks?.[1].reason).toBe('Exit 55점 · 비중 축소 검토');
    expect(checks?.[1].exitScore).toBe(55);

    // 당일 경계: KST 자정 이후 신호만(2026-07-16 00:00 KST = 07-15T15:00Z).
    const where = (prisma.exitSignal.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.checkedAt.gte.toISOString()).toBe('2026-07-15T15:00:00.000Z');
  });

  it('리스크 섹션은 PortfolioService.findLatestRiskSnapshot 위임 결과를 그대로 싣는다', async () => {
    const risk = {
      portfolioId: 'pf-1',
      snapshotDate: '2026-07-16',
      riskLevel: 'WARNING',
      hardRuleBreached: false,
    } as PortfolioRiskSnapshotView;
    const portfolioService = makePortfolioServiceMock(risk);
    const service = new BriefingService(makePrismaMock({}), portfolioService);

    const briefing = await service.buildTodayBriefing('user-7', NOW);

    expect(portfolioService.findLatestRiskSnapshot).toHaveBeenCalledWith('user-7');
    expect(briefing?.risk).toBe(risk);
  });
});
