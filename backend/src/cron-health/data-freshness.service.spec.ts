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
      },
      disclosureCollectionLog: {
        findFirst: successFindFirst({ endedAt: recent, startedAt: recent, newCount: 2 }),
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
      },
      // 도메인 로그는 신선 유지.
      disclosureCollectionLog: {
        findFirst: successFindFirst({ endedAt: recent, startedAt: recent, newCount: 1 }),
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

  it('조회는 read-only — findFirst 만 쓰고 create/update 델리게이트는 없다', async () => {
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
