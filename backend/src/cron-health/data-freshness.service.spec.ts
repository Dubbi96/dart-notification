import { DataFreshnessService } from './data-freshness.service';
import { FRESHNESS_JOB_SPECS } from './cron-health.jobs';

// DataFreshnessService — 로그 출처 매핑 + 순수 판정 결합 검증. Prisma 델리게이트 목 대체.
// read-only: count/insert/update 없이 findFirst 조회만 사용.
describe('DataFreshnessService (DAR-110)', () => {
  // 평일 장중(월요일 10:00)으로 고정 — 장중 잡도 평가 대상.
  const now = new Date('2026-06-08T10:00:00');

  // status 필터가 있으면 '성공 행', 없으면 '최근 상태 행'을 돌려주는 findFirst 목.
  function successFindFirst(successRow: any, statusRow: any = { status: 'SUCCESS' }) {
    return jest.fn((args: any) => {
      const where = args?.where ?? {};
      const hasStatusFilter =
        where.status !== undefined && where.status !== null;
      return Promise.resolve(hasStatusFilter ? successRow : statusRow);
    });
  }

  function makePrisma(over: Record<string, any> = {}) {
    const recent = new Date(now.getTime() - 5 * 60_000); // 5분 전 = 신선
    return {
      cronRunLog: {
        findFirst: successFindFirst({ finishedAt: recent, itemCount: 4 }),
        // [W11] 제로런 축 최근 실행 조회 — 기본은 빈 이력(스트릭 0 → 미발화).
        findMany: jest.fn().mockResolvedValue([]),
      },
      disclosureCollectionLog: {
        findFirst: successFindFirst({ endedAt: recent, startedAt: recent, newCount: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      marketDataCollectionLog: {
        findFirst: successFindFirst({ endedAt: recent, startedAt: recent, savedCount: 900 }),
      },
      financialCollectionLog: {
        findFirst: successFindFirst({ endedAt: recent, startedAt: recent, savedCount: 50 }),
      },
      ...over,
    } as any;
  }

  it('모든 잡이 최근 성공이면 anyStale=false 이고 잡 수가 사양 수와 일치', async () => {
    const service = new DataFreshnessService(makePrisma());
    const report = await service.getFreshness(now);

    expect(report.jobs).toHaveLength(FRESHNESS_JOB_SPECS.length);
    expect(report.anyStale).toBe(false);
    expect(report.staleJobs).toEqual([]);
    expect(report.generatedAt).toBe(now.toISOString());
  });

  it('DAR-232: cleanup·KIS 잡이 신선도 안전망 사양에 포함된다', async () => {
    const cleanup = FRESHNESS_JOB_SPECS.find((s) => s.jobKey === 'cleanup.daily');
    const kis = FRESHNESS_JOB_SPECS.find((s) => s.jobKey === 'kis.realtime-poll');

    // 두 잡 모두 CronRunLog 기반으로 표면화된다(실패 관측성).
    expect(cleanup).toBeDefined();
    expect(cleanup?.source).toBe('CRON_RUN_LOG');
    expect(kis).toBeDefined();
    expect(kis?.source).toBe('CRON_RUN_LOG');
    // KIS 는 장중 폴러 — 장외시간 오탐 방지 위해 WEEKDAY_INTRADAY 윈도.
    expect(kis?.window).toBe('WEEKDAY_INTRADAY');
  });

  it('CronRunLog 성공 기록이 없으면 해당 잡이 stale 로 표면화된다', async () => {
    const recent = new Date(now.getTime() - 5 * 60_000);
    const prisma = makePrisma({
      cronRunLog: {
        // 성공행 null(미가동), 최근상태 행도 null.
        findFirst: successFindFirst(null, null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // 도메인 로그는 신선 유지.
      disclosureCollectionLog: {
        findFirst: successFindFirst({ endedAt: recent, startedAt: recent, newCount: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const service = new DataFreshnessService(prisma);
    const report = await service.getFreshness(now);

    // CRON_RUN_LOG 소스 잡(신호·모의운용·내부자·파싱재처리)이 모두 stale.
    const cronJobs = FRESHNESS_JOB_SPECS.filter((s) => s.source === 'CRON_RUN_LOG');
    expect(report.anyStale).toBe(true);
    for (const job of cronJobs) {
      expect(report.staleJobs).toContain(job.jobKey);
    }
  });

  // [W11] 제로런 배선 — 서비스가 최근 성공 실행 이력을 조회해 순수 판정에 넘기는지.
  it('W11: 공시 장중 폴링이 당일 연속 0건이면 제로런 stale 로 표면화된다', async () => {
    const recent = new Date(now.getTime() - 5 * 60_000);
    // 임계 9회(사양)의 당일 연속 0건 성공 이력.
    const zeroRuns = Array.from({ length: 9 }, (_, i) => ({
      endedAt: new Date(now.getTime() - (5 + i * 10) * 60_000),
      startedAt: new Date(now.getTime() - (6 + i * 10) * 60_000),
      newCount: 0,
    }));
    const prisma = makePrisma({
      disclosureCollectionLog: {
        // 마지막 성공은 신선(5분 전) — age 축은 통과, 제로런 축만 발화해야 한다.
        findFirst: successFindFirst({ endedAt: recent, startedAt: recent, newCount: 0 }),
        findMany: jest.fn().mockResolvedValue(zeroRuns),
      },
    });
    const report = await new DataFreshnessService(prisma).getFreshness(now);

    const job = report.jobs.find((j) => j.jobKey === 'disclosure.intraday');
    expect(job?.zeroRunStreak).toBe(9);
    expect(job?.isZeroRun).toBe(true);
    expect(job?.isStale).toBe(true);
    expect(report.staleJobs).toContain('disclosure.intraday');
  });

  it('W11: 제로런 임계 잡만 최근 이력(findMany)을 조회한다(take=임계)', async () => {
    const prisma = makePrisma();
    await new DataFreshnessService(prisma).getFreshness(now);

    // DISCLOSURE_LOG 제로런 잡(공시 장중 폴링) — 임계 9건 조회.
    expect(prisma.disclosureCollectionLog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.disclosureCollectionLog.findMany.mock.calls[0][0].take).toBe(9);
    // CRON_RUN_LOG 제로런 잡 — KIS 실시간(30)·분봉(6) 2건만.
    const cronCalls = prisma.cronRunLog.findMany.mock.calls;
    expect(cronCalls).toHaveLength(2);
    const byJob = Object.fromEntries(
      cronCalls.map((c: any[]) => [c[0].where.jobKey, c[0].take]),
    );
    expect(byJob['kis.realtime-poll']).toBe(30);
    expect(byJob['market.minute-collect']).toBe(6);
  });

  it('조회는 read-only — findFirst/findMany 만 쓰고 create/update 델리게이트는 없다', async () => {
    const prisma = makePrisma();
    const service = new DataFreshnessService(prisma);
    await service.getFreshness(now);
    // 목에 create/update 가 정의되지 않았음에도 정상 동작 = 쓰기 호출 없음의 방증.
    expect((prisma.cronRunLog as any).create).toBeUndefined();
    expect((prisma.cronRunLog as any).update).toBeUndefined();
  });

  it('동일 입력·동일 now 는 결정론적으로 동일 결과', async () => {
    const a = await new DataFreshnessService(makePrisma()).getFreshness(now);
    const b = await new DataFreshnessService(makePrisma()).getFreshness(now);
    expect(a).toEqual(b);
  });
});
