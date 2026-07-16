/**
 * disclosure-reaction-stats.service.spec.ts — 유사공시 반응 통계 (DAR-511 / Wave A·A1)
 *
 * 검증 초점:
 *  - 수용기준 1(정직 게이트): 게이트는 표본수 n≥30 — 소표본은 통계값이 존재해도
 *    stats=null+INSUFFICIENT_SAMPLE 로 가려 "승률 100% (n=3)" 허수를 차단한다.
 *  - 관측을 집계: EventStudyObservation 에서 D+1/D+5/D+20 누적 단순수익률·초과수익·상승비율을 산출.
 *  - 이벤트 미추출 공시 → results=[](에러 아님).
 *  - eventType 스냅샷 일1회 캐시(같은 날 재조회 0).
 */
import {
  DisclosureReactionStatsService,
  buildReactionResult,
  ReactionObservation,
} from './disclosure-reaction-stats.service';

const AS_OF = new Date('2026-07-15T00:00:00.000Z');

/** 일별 +val(%) 20일 관측치 — 누적 단순수익률이 모든 지평에서 val 배수(양/음 일관). */
function makeObs(
  dailyVal: number,
  ar: { d1: number; d5: number; d20: number },
  over: Partial<ReactionObservation> = {},
): ReactionObservation {
  const dr: Record<string, number> = {};
  for (let k = 1; k <= 20; k++) dr[`d${k}`] = dailyVal;
  return {
    dailyReturns: over.dailyReturns ?? dr,
    cumulativeAR: over.cumulativeAR ?? { d1: ar.d1, d5: ar.d5, d20: ar.d20 },
    d0Date: over.d0Date ?? '20250115',
    createdAt: over.createdAt ?? AS_OF,
  };
}

/** 18 양(+0.5/일) + 12 음(-0.5/일) = n=30, 모든 지평 상승비율 0.6. */
function mixedThirty(): ReactionObservation[] {
  const pos = Array.from({ length: 18 }, (_, i) =>
    makeObs(0.5, { d1: 0.3, d5: 1.5, d20: 6 }, {
      d0Date: i === 0 ? '20240101' : '20250115',
    }),
  );
  const neg = Array.from({ length: 12 }, (_, i) =>
    makeObs(-0.5, { d1: -0.3, d5: -1.5, d20: -6 }, {
      d0Date: i === 0 ? '20260630' : '20250115',
      createdAt: i === 0 ? new Date('2026-07-15T09:00:00.000Z') : AS_OF,
    }),
  );
  return [...pos, ...neg];
}

describe('buildReactionResult() — n≥30 정직 게이트 + 관측치 집계', () => {
  const MIN = DisclosureReactionStatsService.MIN_SAMPLE_SIZE;

  it('MIN_SAMPLE_SIZE 는 통계 유의 READY 임계(30)와 동일 상수 재사용', () => {
    expect(MIN).toBe(30);
  });

  it('n≥30 → D+1/D+5/D+20 누적 단순수익률·초과수익·상승비율 + 산출기간/기준일', () => {
    const res = buildReactionResult('SUPPLY_CONTRACT', mixedThirty(), MIN);

    expect(res.reason).toBeNull();
    expect(res.sampleCount).toBe(30);
    expect(res.stats).not.toBeNull();

    // 누적 단순수익률 평균: (0.5·d배수·18 − 0.5·d배수·12)/30
    expect(res.stats!.d1).toEqual({ avgReturn: 0.1, avgAbnormalReturn: 0.06, winRate: 0.6 });
    expect(res.stats!.d5).toEqual({ avgReturn: 0.5, avgAbnormalReturn: 0.3, winRate: 0.6 });
    expect(res.stats!.d20).toEqual({ avgReturn: 2, avgAbnormalReturn: 1.2, winRate: 0.6 });

    // 산출기간 = D0 최소~최대, 기준일 = 최신 영속 시각
    expect(res.period).toEqual({ fromDate: '20240101', toDate: '20260630' });
    expect(res.calculatedAt).toBe('2026-07-15T09:00:00.000Z');
  });

  it('소표본(n=3) 전부 상승(승률 100%) 이라도 n<30 → stats=null+INSUFFICIENT_SAMPLE', () => {
    const rows = Array.from({ length: 3 }, () => makeObs(0.5, { d1: 0.3, d5: 1.5, d20: 6 }));
    const res = buildReactionResult('SUPPLY_CONTRACT', rows, MIN);

    expect(res.stats).toBeNull();
    expect(res.reason).toBe('INSUFFICIENT_SAMPLE');
    expect(res.sampleCount).toBe(3); // n 은 있는 그대로 노출(투명성)
    expect(res.period).not.toBeNull(); // 표본 있으면 기간/기준일은 노출
    expect(res.calculatedAt).not.toBeNull();
  });

  it('경계값: n=29 → 차단, n=30 → 노출', () => {
    const make = (n: number) =>
      Array.from({ length: n }, () => makeObs(0.5, { d1: 0.3, d5: 1.5, d20: 6 }));
    expect(buildReactionResult('X', make(29), MIN).stats).toBeNull();
    expect(buildReactionResult('X', make(30), MIN).stats).not.toBeNull();
  });

  it('표본 0 → stats=null+INSUFFICIENT_SAMPLE, n=0, 기간/기준일 null', () => {
    const res = buildReactionResult('LAWSUIT', [], MIN);
    expect(res.stats).toBeNull();
    expect(res.reason).toBe('INSUFFICIENT_SAMPLE');
    expect(res.sampleCount).toBe(0);
    expect(res.period).toBeNull();
    expect(res.calculatedAt).toBeNull();
  });

  it('cumulativeAR 결측 지평은 avgAbnormalReturn=null (수익률·상승비율은 유지)', () => {
    const rows = Array.from({ length: 30 }, () =>
      makeObs(0.5, { d1: 0.3, d5: 1.5, d20: 6 }, { cumulativeAR: {} }),
    );
    const res = buildReactionResult('X', rows, MIN);
    expect(res.stats!.d5.avgAbnormalReturn).toBeNull();
    expect(res.stats!.d5.avgReturn).toBe(2.5); // 0.5×5 (dailyReturns 로 계산)
    expect(res.stats!.d5.winRate).toBe(1);
  });
});

function makePrisma(opts: {
  event: { eventType: string } | null;
  rows: ReactionObservation[];
}) {
  const findManyArgs: any[] = [];
  return {
    findManyArgs,
    disclosureEvent: {
      findUnique: jest.fn(async () => opts.event),
    },
    eventStudyObservation: {
      findMany: jest.fn(async (arg: any) => {
        findManyArgs.push(arg);
        return opts.rows;
      }),
    },
  };
}

describe('DisclosureReactionStatsService.getReactionStatsByRcpNo()', () => {
  it('n≥30 유형 공시 → results[0] 통계 노출', async () => {
    const prisma = makePrisma({ event: { eventType: 'SUPPLY_CONTRACT' }, rows: mixedThirty() });
    const svc = new DisclosureReactionStatsService(prisma as any);
    const out = await svc.getReactionStatsByRcpNo('rcp-1');

    expect(out.rcpNo).toBe('rcp-1');
    expect(out.minSampleSize).toBe(30);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].eventType).toBe('SUPPLY_CONTRACT');
    expect(out.results[0].stats).not.toBeNull();
    expect(out.results[0].reason).toBeNull();
  });

  it('n<30 유형 공시 → results[0] stats=null+INSUFFICIENT_SAMPLE', async () => {
    const rows = Array.from({ length: 12 }, () => makeObs(0.5, { d1: 0.3, d5: 1.5, d20: 6 }));
    const prisma = makePrisma({ event: { eventType: 'SUPPLY_CONTRACT' }, rows });
    const svc = new DisclosureReactionStatsService(prisma as any);
    const out = await svc.getReactionStatsByRcpNo('rcp-2');

    expect(out.results[0].stats).toBeNull();
    expect(out.results[0].reason).toBe('INSUFFICIENT_SAMPLE');
    expect(out.results[0].sampleCount).toBe(12);
  });

  it('이벤트 미추출 공시 → results=[] (관측치 미조회)', async () => {
    const prisma = makePrisma({ event: null, rows: [] });
    const svc = new DisclosureReactionStatsService(prisma as any);
    const out = await svc.getReactionStatsByRcpNo('rcp-3');
    expect(out.results).toEqual([]);
    expect(prisma.eventStudyObservation.findMany).not.toHaveBeenCalled();
  });

  it('관측치 조회는 eventType where 로 로드', async () => {
    const prisma = makePrisma({ event: { eventType: 'SUPPLY_CONTRACT' }, rows: mixedThirty() });
    const svc = new DisclosureReactionStatsService(prisma as any);
    await svc.getReactionStatsByRcpNo('rcp-4');
    expect(prisma.findManyArgs[0].where).toEqual({ eventType: 'SUPPLY_CONTRACT' });
  });

  it('eventType 스냅샷 일1회 캐시 — 같은 날 두 번째 조회는 관측치 재조회 0', async () => {
    const prisma = makePrisma({ event: { eventType: 'SUPPLY_CONTRACT' }, rows: mixedThirty() });
    const svc = new DisclosureReactionStatsService(prisma as any);
    await svc.getReactionStatsByRcpNo('rcp-5');
    await svc.getReactionStatsByRcpNo('rcp-5');
    expect(prisma.eventStudyObservation.findMany).toHaveBeenCalledTimes(1);
  });
});
