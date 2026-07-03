import { OpsDailyReportService } from './ops-daily-report.service';
import { OpsMetricsService } from './ops-metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { OpsMetrics } from './ops-metrics.types';

/**
 * DAR-477(견고화 W0·P05) — 일일 운영 리포트 생성 서비스 단위 테스트.
 * 결정론: now 주입 + prisma/OpsMetrics mock. read-only 집계라 부작용 0.
 */
describe('OpsDailyReportService (DAR-477)', () => {
  // 20:35 UTC = 익일 05:35 KST → reportDateKst 는 KST 거래일이어야 한다(TZ 경계 회귀 방지).
  const NOW = new Date('2026-07-02T11:30:00.000Z'); // = 2026-07-02 20:30 KST

  function makeMetrics(over: Partial<OpsMetrics> = {}): OpsMetrics {
    return {
      generatedAt: NOW.toISOString(),
      aiUsage: {
        totalCalls: 42,
        totalCostUsd: 1.2345,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
      signals: { last24h: 7, last7d: 20, total: 100 },
      simulationPositions: { open: 5, closed: 16, total: 21 },
      collection: { anyStale: false, staleJobs: [], jobs: [] },
      graduation: null,
      pipeline: null,
      slippage: {
        overall: {
          tradeCount: 10,
          avgSlippageKrw: 12.5,
          p95SlippageKrw: 40,
          totalFeesKrw: 100,
          avgSlippageBps: 3.2,
          p95SlippageBps: 9,
          bpsSampleSize: 8,
        },
        byTrack: [],
      },
      ...over,
    };
  }

  interface PrismaFixtures {
    positionGroups?: unknown[];
    portfolios?: Array<{ id: string; name: string }>;
    scalpClosed?: unknown[];
    scalpOpen?: unknown[];
    paperFills?: unknown[];
    scalpFills?: unknown[];
    cronByStatus?: unknown[];
    cronFailedJobs?: unknown[];
  }

  function makePrisma(fx: PrismaFixtures) {
    return {
      position: {
        groupBy: jest.fn().mockResolvedValue(fx.positionGroups ?? []),
      },
      portfolio: {
        findMany: jest.fn().mockResolvedValue(fx.portfolios ?? []),
      },
      intradayScalpTrade: {
        groupBy: jest.fn().mockImplementation((args: any) => {
          // pnl-closed: _sum.netPnl 요청. pnl-open: where.status==='OPEN'. fills: where.exitTs.
          if (args?._sum?.netPnl) return Promise.resolve(fx.scalpClosed ?? []);
          if (args?.where?.exitTs) return Promise.resolve(fx.scalpFills ?? []);
          if (args?.where?.status === 'OPEN') return Promise.resolve(fx.scalpOpen ?? []);
          return Promise.resolve([]);
        }),
      },
      paperTrade: {
        groupBy: jest.fn().mockResolvedValue(fx.paperFills ?? []),
      },
      cronRunLog: {
        groupBy: jest.fn().mockImplementation((args: any) => {
          if (args?.by?.[0] === 'jobKey') return Promise.resolve(fx.cronFailedJobs ?? []);
          return Promise.resolve(fx.cronByStatus ?? []);
        }),
      },
    } as unknown as PrismaService;
  }

  function makeService(over: Partial<OpsMetrics>, fx: PrismaFixtures) {
    const opsMetrics = {
      getMetrics: jest.fn().mockResolvedValue(makeMetrics(over)),
    } as unknown as OpsMetricsService;
    return new OpsDailyReportService(makePrisma(fx), opsMetrics);
  }

  it('트랙별 손익·체결·크론 오류율을 집계하고 KST 거래일을 고정한다', async () => {
    const service = makeService(
      {},
      {
        positionGroups: [
          { portfolioId: 'pf-sim', status: 'OPEN', _sum: { unrealizedPnl: -56000 }, _count: { _all: 3 } },
          { portfolioId: 'pf-sim', status: 'CLOSED', _sum: { unrealizedPnl: 1234000 }, _count: { _all: 12 } },
          { portfolioId: 'pf-strat', status: 'OPEN', _sum: { unrealizedPnl: 10000 }, _count: { _all: 1 } },
        ],
        portfolios: [
          { id: 'pf-sim', name: '기본 포트폴리오' },
          { id: 'pf-strat', name: '전략:모멘텀' },
        ],
        scalpClosed: [{ styleTag: 'intraday-scalp', _sum: { netPnl: 5000 }, _count: { _all: 4 } }],
        scalpOpen: [{ styleTag: 'intraday-scalp', _count: { _all: 2 } }],
        paperFills: [
          { styleTag: 'strategy:momentum', _count: { _all: 2 } },
          { styleTag: null, _count: { _all: 1 } },
        ],
        scalpFills: [{ styleTag: 'intraday-scalp', _count: { _all: 4 } }],
        cronByStatus: [{ status: 'SUCCESS', _count: { _all: 40 } }],
        cronFailedJobs: [],
      },
    );

    const r = await service.buildReport(NOW);

    // KST 거래일(2026-07-02) — UTC 11:30 → KST 20:30 동일일.
    expect(r.reportDateKst).toBe('2026-07-02');
    expect(r.generatedAt).toBe(NOW.toISOString());

    // 트랙 손익 — 라벨로 조회(정렬 순서 로케일 의존 회피).
    const find = (label: string) => r.pnl.byTrack.find((t) => t.label === label);
    expect(find('기본 포트폴리오')).toMatchObject({
      realizedPnlKrw: 1234000,
      unrealizedPnlKrw: -56000,
      openPositions: 3,
      closedPositions: 12,
    });
    expect(find('전략:모멘텀')).toMatchObject({
      realizedPnlKrw: 0,
      unrealizedPnlKrw: 10000,
      openPositions: 1,
      closedPositions: 0,
    });
    expect(find('intraday-scalp')).toMatchObject({
      realizedPnlKrw: 5000,
      unrealizedPnlKrw: 0,
      openPositions: 2,
      closedPositions: 4,
    });
    expect(r.pnl.totalRealizedPnlKrw).toBe(1239000);
    expect(r.pnl.totalUnrealizedPnlKrw).toBe(-46000);

    // 체결(24h) — 트랙 합산.
    expect(r.fills.total).toBe(7);
    const fill = (tag: string) => r.fills.byTrack.find((f) => f.styleTag === tag)?.fills;
    expect(fill('strategy:momentum')).toBe(2);
    expect(fill('(untagged)')).toBe(1);
    expect(fill('intraday-scalp')).toBe(4);

    // 크론 — 실패 0 → 오류율 0, 심각도 INFO.
    expect(r.cron).toMatchObject({ totalRuns: 40, failedRuns: 0, errorRatePct: 0 });
    expect(r.severity).toBe('INFO');

    // 재사용 필드.
    expect(r.signals24h).toBe(7);
    expect(r.aiCostUsdTotal).toBe(1.2345);
    expect(r.slippage?.overall.tradeCount).toBe(10);

    // 본문 다이제스트 핵심 문자열.
    expect(r.body).toContain('일일 운영 리포트 (2026-07-02 KST)');
    expect(r.body).toContain('기본 포트폴리오: 실현 +1,234,000원 · 평가 -56,000원 (보유 3 · 청산 12)');
    expect(r.body).toContain('총 7건');
    expect(r.body).toContain('오류율 0%');
  });

  it('크론 실패가 있으면 오류율을 계산하고 WARNING·실패 잡을 정렬 노출한다', async () => {
    const service = makeService(
      {},
      {
        cronByStatus: [
          { status: 'SUCCESS', _count: { _all: 40 } },
          { status: 'FAILED', _count: { _all: 2 } },
          { status: 'SKIPPED', _count: { _all: 1 } },
        ],
        cronFailedJobs: [
          { jobKey: 'market.daily-collect', _count: { _all: 1 } },
          { jobKey: 'ai.backfill-drain', _count: { _all: 1 } },
        ],
      },
    );

    const r = await service.buildReport(NOW);
    expect(r.cron.totalRuns).toBe(43);
    expect(r.cron.failedRuns).toBe(2);
    expect(r.cron.errorRatePct).toBe(4.7); // round(2/43*100,1)
    expect(r.cron.failedJobKeys).toEqual(['ai.backfill-drain', 'market.daily-collect']);
    expect(r.severity).toBe('WARNING');
    expect(r.body).toContain('실패 잡: ai.backfill-drain, market.daily-collect');
  });

  it('크론 실패가 없어도 freshness stale 이 있으면 WARNING 이다', async () => {
    const service = makeService(
      { collection: { anyStale: true, staleJobs: ['krx.daily'], jobs: [] } },
      { cronByStatus: [{ status: 'SUCCESS', _count: { _all: 10 } }] },
    );
    const r = await service.buildReport(NOW);
    expect(r.cron.failedRuns).toBe(0);
    expect(r.cron.staleJobs).toEqual(['krx.daily']);
    expect(r.severity).toBe('WARNING');
    expect(r.body).toContain('정체(stale): krx.daily');
  });

  it('데이터가 비어도 골격을 정직하게 반환한다(가짜 비율 금지)', async () => {
    const service = makeService({ slippage: null }, {});
    const r = await service.buildReport(NOW);
    expect(r.pnl.byTrack).toEqual([]);
    expect(r.pnl.totalRealizedPnlKrw).toBe(0);
    expect(r.fills.total).toBe(0);
    expect(r.cron.totalRuns).toBe(0);
    expect(r.cron.errorRatePct).toBeNull(); // 총 실행 0 → null(0% 오탐 금지)
    expect(r.severity).toBe('INFO');
    expect(r.body).toContain('(집계 대상 트랙 없음)');
    expect(r.body).toContain('(집계 불가)');
  });
});
