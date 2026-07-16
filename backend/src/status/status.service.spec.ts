import { StatusService } from './status.service';
import { DataFreshnessService } from '../cron-health/data-freshness.service';
import { FreshnessReport } from '../cron-health/freshness';

// [W11/W12] 공개 /status 집계 — read-only 집계·성공률 산식·60초 캐시 계약 검증.
// Prisma/신선도 서비스 목 대체 — DB·외부호출 없음.
describe('StatusService (W11/W12)', () => {
  const now = new Date('2026-07-15T10:00:00+09:00');

  function freshnessReport(over: Partial<FreshnessReport> = {}): FreshnessReport {
    return {
      generatedAt: now.toISOString(),
      anyStale: false,
      staleJobs: [],
      jobs: [],
      ...over,
    };
  }

  function makeFreshness(report: FreshnessReport) {
    return {
      getFreshness: jest.fn().mockResolvedValue(report),
    } as unknown as DataFreshnessService;
  }

  interface PrismaOver {
    disclosureCount?: number;
    lastLog?: { endedAt: Date | null; startedAt: Date } | null;
    cronGroups?: { status: string; _count: { _all: number } }[];
  }

  function makePrisma(over: PrismaOver = {}) {
    return {
      disclosure: {
        count: jest.fn().mockResolvedValue(over.disclosureCount ?? 120),
      },
      disclosureCollectionLog: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            over.lastLog === undefined
              ? { endedAt: new Date('2026-07-15T09:55:00+09:00'), startedAt: now }
              : over.lastLog,
          ),
      },
      cronRunLog: {
        groupBy: jest.fn().mockResolvedValue(
          over.cronGroups ?? [
            { status: 'SUCCESS', _count: { _all: 40 } },
            { status: 'SKIPPED', _count: { _all: 8 } },
            { status: 'FAILED', _count: { _all: 2 } },
            { status: 'RUNNING', _count: { _all: 3 } },
          ],
        ),
      },
    } as any;
  }

  it('운영 사실을 집계한다 — 오늘 수집 건수·성공률(SKIPPED 정상·RUNNING 분모 제외)', async () => {
    const prisma = makePrisma();
    const service = new StatusService(prisma, makeFreshness(freshnessReport()));

    const s = await service.getStatus(now);

    expect(s.disclosure.todayCollectedCount).toBe(120);
    expect(s.disclosure.lastCollectedAt).toBe(
      new Date('2026-07-15T09:55:00+09:00').toISOString(),
    );
    // SUCCESS 40 + SKIPPED 8 = ok 48, 분모 50(RUNNING 3 제외) → 96%.
    expect(s.cron.totalRuns).toBe(50);
    expect(s.cron.okRuns).toBe(48);
    expect(s.cron.successRatePct).toBe(96);
    expect(s.service.status).toBe('OK');
    expect(s.service.label).toBe('정상 가동');
    expect(s.pipeline.status).toBe('OK');
    // 오늘 수집 건수는 백필 제외 + KST 자정 이후 범위로 센다(공개 표면 정직성).
    const countArgs = prisma.disclosure.count.mock.calls[0][0];
    expect(countArgs.where.isBackfill).toBe(false);
    expect(countArgs.where.createdAt.gte).toEqual(
      new Date('2026-07-15T00:00:00+09:00'),
    );
  });

  it('최근 24h 크론 실행이 0건이면 성공률은 null(0% 오표기 방지)', async () => {
    const service = new StatusService(
      makePrisma({ cronGroups: [] }),
      makeFreshness(freshnessReport()),
    );
    const s = await service.getStatus(now);
    expect(s.cron.totalRuns).toBe(0);
    expect(s.cron.successRatePct).toBeNull();
  });

  it('신선도 정체가 있으면 서비스 상태 DEGRADED, 파이프라인 잡 정체면 파이프라인도 지연', async () => {
    const report = freshnessReport({
      anyStale: true,
      staleJobs: ['pipeline.drain'],
      jobs: [
        {
          jobKey: 'pipeline.drain',
          label: '파이프라인 폐루프 드레인',
          cadence: '매 1분',
          applicable: true,
          isStale: true,
          lastSuccessAt: null,
          lastStatus: 'FAILED',
          lastItemCount: null,
          ageMinutes: 90,
          zeroRunStreak: null,
          isZeroRun: false,
          reason: '정체',
        },
      ],
    });
    const service = new StatusService(makePrisma(), makeFreshness(report));
    const s = await service.getStatus(now);

    expect(s.service.status).toBe('DEGRADED');
    expect(s.service.label).toBe('일부 수집 지연');
    expect(s.pipeline.status).toBe('DEGRADED');
    expect(s.pipeline.staleJobKeys).toEqual(['pipeline.drain']);
  });

  it('[DAR-515] 공시 제로런 정체(isZeroRun)도 서비스 상태를 DEGRADED 로 표면화한다(/status 연동)', async () => {
    const report = freshnessReport({
      anyStale: true,
      staleJobs: ['disclosure.intraday'],
      jobs: [
        {
          jobKey: 'disclosure.intraday',
          label: '공시 장중 폴링',
          cadence: '평일 08:00~18:00 / 10분',
          applicable: true,
          isStale: true,
          lastSuccessAt: now.toISOString(),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          ageMinutes: 5, // age 축은 신선 — 제로런 축만으로 stale
          zeroRunStreak: 9,
          isZeroRun: true,
          reason: '장중 연속 9회 0행 산출(임계 9회) — 제로런 정체 의심',
        },
      ],
    });
    const service = new StatusService(makePrisma(), makeFreshness(report));
    const s = await service.getStatus(now);

    expect(s.service.status).toBe('DEGRADED');
    expect(s.service.label).toBe('일부 수집 지연');
  });

  it('파이프라인 외 잡만 정체면 서비스는 DEGRADED, 파이프라인은 정상', async () => {
    const report = freshnessReport({
      anyStale: true,
      staleJobs: ['krx.daily'],
      jobs: [
        {
          jobKey: 'krx.daily',
          label: 'KRX 일봉·지수 수집',
          cadence: '평일',
          applicable: true,
          isStale: true,
          lastSuccessAt: null,
          lastStatus: 'FAILED',
          lastItemCount: null,
          ageMinutes: 5000,
          zeroRunStreak: null,
          isZeroRun: false,
          reason: '정체',
        },
      ],
    });
    const service = new StatusService(makePrisma(), makeFreshness(report));
    const s = await service.getStatus(now);

    expect(s.service.status).toBe('DEGRADED');
    expect(s.pipeline.status).toBe('OK');
    expect(s.pipeline.staleJobKeys).toEqual([]);
  });

  it('60초 인메모리 캐시 — TTL 내 재호출은 DB 재조회 없이 동일 스냅샷', async () => {
    const prisma = makePrisma();
    const freshness = makeFreshness(freshnessReport());
    const service = new StatusService(prisma, freshness);

    const first = await service.getStatus(now);
    const second = await service.getStatus(new Date(now.getTime() + 30_000));

    expect(second).toBe(first); // 동일 객체 = 캐시 히트
    expect(prisma.disclosure.count).toHaveBeenCalledTimes(1);
    expect((freshness.getFreshness as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('60초 경과 후에는 재집계한다(캐시 만료)', async () => {
    const prisma = makePrisma();
    const service = new StatusService(prisma, makeFreshness(freshnessReport()));

    await service.getStatus(now);
    await service.getStatus(new Date(now.getTime() + 61_000));

    expect(prisma.disclosure.count).toHaveBeenCalledTimes(2);
  });

  it('공개 표면 무결성 — 스냅샷에 성과·수익률 필드가 없다(운영 사실만)', async () => {
    const service = new StatusService(makePrisma(), makeFreshness(freshnessReport()));
    const s = await service.getStatus(now);

    const json = JSON.stringify(s).toLowerCase();
    for (const forbidden of ['return', 'profit', 'pnl', 'score', '수익']) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(s).sort()).toEqual(
      ['cron', 'disclosure', 'generatedAt', 'pipeline', 'service'].sort(),
    );
  });
});
