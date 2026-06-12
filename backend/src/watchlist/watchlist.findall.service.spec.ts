// backend/src/watchlist/watchlist.findall.service.spec.ts
// DAR-185 회귀 통합 스펙 — 워치리스트 "같은 날" 공시 unread 집계.
//
// 버그(수정 전): rcpDt 는 DART rcept_dt 라 항상 8자리(YYYYMMDD)인데, lastViewedAt 을
// 14자리 임계 문자열로 만들어 `rcpDt > threshold` 로 비교했다. 8자리는 14자리 임계의
// 접두사라 항상 작아(`'20260612' > '20260612090000'` === false), "오늘 들어온 공시"는
// 자정 롤오버 전까지 절대 newDisclosureCount 에 잡히지 않았다.
//
// 수정(DAR-185): 자연키 rcpNo(='YYYYMMDD'+일련번호, 14자리 단조)를 커서로 사용한다.
// markViewed 가 본 시점의 최신 rcpNo 를 lastViewedRcpNo 로 고정하고, findAll 은
// `rcpNo > 커서` 로 센다 → 같은 날 이후 접수된 공시도 정확히 신규로 집계된다.
//
// 인메모리 Prisma 가짜는 findAll 이 실제로 호출하는 세 쿼리만 충실히 구현한다:
//   1) watchList.findMany({ where:{userId}, orderBy, include:{company} })
//   2) disclosure.groupBy({ by:['corpCode'], where:{corpCode:{in}}, _max:{rcpDt} })
//   3) disclosure.count({ where:{corpCode, rcpNo:{gt: cursor}} })

import { Test, TestingModule } from '@nestjs/testing';
import { WatchlistService } from './watchlist.service';
import { PrismaService } from '../prisma/prisma.service';

type DiscRow = { corpCode: string; rcpNo: string; rcpDt: string };
type WatchRow = {
  id: string;
  userId: string;
  corpCode: string;
  corpName: string;
  createdAt: Date;
  lastViewedAt: Date | null;
  lastViewedRcpNo: string | null;
};

function makeMockPrisma(watch: WatchRow[], disclosures: DiscRow[]) {
  const prisma: any = {
    watchList: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        watch
          .filter((w) => w.userId === where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((w) => ({ ...w, company: { stockCode: null, market: null } })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId: string; corpCode: string };
        data: { lastViewedAt: Date; lastViewedRcpNo?: string };
      }) => {
        let count = 0;
        for (const w of watch) {
          if (w.userId === where.userId && w.corpCode === where.corpCode) {
            w.lastViewedAt = data.lastViewedAt;
            if (data.lastViewedRcpNo !== undefined) {
              w.lastViewedRcpNo = data.lastViewedRcpNo;
            }
            count++;
          }
        }
        return { count };
      },
    },
    disclosure: {
      groupBy: async ({ where }: { where: { corpCode: { in: string[] } } }) => {
        const set = new Set(where.corpCode.in);
        const byCorp = new Map<string, string>();
        for (const d of disclosures) {
          if (!set.has(d.corpCode)) continue;
          const cur = byCorp.get(d.corpCode);
          if (cur === undefined || d.rcpDt > cur) byCorp.set(d.corpCode, d.rcpDt);
        }
        return [...byCorp.entries()].map(([corpCode, rcpDt]) => ({
          corpCode,
          _max: { rcpDt },
        }));
      },
      count: async ({
        where,
      }: {
        where: { corpCode: string; rcpNo: { gt: string } };
      }) =>
        disclosures.filter(
          (d) => d.corpCode === where.corpCode && d.rcpNo > where.rcpNo.gt,
        ).length,
      aggregate: async ({ where }: { where: { corpCode: string } }) => {
        let max: string | null = null;
        for (const d of disclosures) {
          if (d.corpCode !== where.corpCode) continue;
          if (max === null || d.rcpNo > max) max = d.rcpNo;
        }
        return { _max: { rcpNo: max } };
      },
    },
  };
  return prisma;
}

async function buildService(prisma: any): Promise<WatchlistService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      WatchlistService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return moduleRef.get(WatchlistService);
}

describe('WatchlistService.findAll — DAR-185 같은 날 unread 집계', () => {
  const USER = 'user-1';
  const CORP = '00126380';
  // 등록 시각: 2026-06-12 09:00 KST (UTC 00:00). 같은 날 사용자가 오전에 한 번 조회한 상황을 가정.
  const createdAt = new Date('2026-06-12T00:00:00.000Z');

  it('★ 핵심: 조회 후 같은 날 들어온 공시가 newDisclosureCount 에 잡힌다(수정 전엔 0)', async () => {
    // 사용자가 09:00 에 본 마지막 공시 = rcpNo 20260612000100 (커서).
    const watch: WatchRow[] = [
      {
        id: 'w1',
        userId: USER,
        corpCode: CORP,
        corpName: '삼성전자',
        createdAt,
        lastViewedAt: new Date('2026-06-12T00:00:00.000Z'),
        lastViewedRcpNo: '20260612000100',
      },
    ];
    // 오후에 같은 날(rcpDt 20260612, 8자리) 새 공시 2건이 더 큰 rcpNo 로 접수.
    const disclosures: DiscRow[] = [
      { corpCode: CORP, rcpNo: '20260612000100', rcpDt: '20260612' }, // 이미 본 것(커서)
      { corpCode: CORP, rcpNo: '20260612000205', rcpDt: '20260612' }, // 신규(같은 날 이후)
      { corpCode: CORP, rcpNo: '20260612000301', rcpDt: '20260612' }, // 신규(같은 날 이후)
    ];

    const service = await buildService(makeMockPrisma(watch, disclosures));
    const res = await service.findAll(USER);

    expect(res.items).toHaveLength(1);
    // 수정 전: rcpDt('20260612') > '20260612090000' === false 라 항상 0 (버그).
    expect(res.items[0].newDisclosureCount).toBe(2);
    expect(res.items[0].lastDisclosureDate).toBe('20260612');
  });

  it('조회 직후(markViewed 로 커서=최신 rcpNo 고정) 배지는 0', async () => {
    const watch: WatchRow[] = [
      {
        id: 'w1',
        userId: USER,
        corpCode: CORP,
        corpName: '삼성전자',
        createdAt,
        lastViewedAt: null,
        lastViewedRcpNo: null,
      },
    ];
    const disclosures: DiscRow[] = [
      { corpCode: CORP, rcpNo: '20260612000205', rcpDt: '20260612' },
      { corpCode: CORP, rcpNo: '20260612000301', rcpDt: '20260612' },
    ];
    const prisma = makeMockPrisma(watch, disclosures);
    const service = await buildService(prisma);

    // 조회 전: floor(등록일 20260612000000) 기준 → 같은 날 공시 2건 모두 신규.
    expect((await service.findAll(USER)).items[0].newDisclosureCount).toBe(2);

    // 조회 → 커서가 최신 rcpNo(20260612000301)로 고정.
    const marked = await service.markViewed(USER, CORP);
    expect(marked.updated).toBe(1);
    expect(watch[0].lastViewedRcpNo).toBe('20260612000301');

    // 조회 직후: 더 큰 rcpNo 없음 → 0.
    expect((await service.findAll(USER)).items[0].newDisclosureCount).toBe(0);

    // 조회 이후 같은 날 또 새 공시 → 다시 1.
    disclosures.push({
      corpCode: CORP,
      rcpNo: '20260612000402',
      rcpDt: '20260612',
    });
    expect((await service.findAll(USER)).items[0].newDisclosureCount).toBe(1);
  });

  it('한 번도 조회 안 한 신규 항목은 등록일 floor 폴백으로 당일 공시를 신규로 본다', async () => {
    const watch: WatchRow[] = [
      {
        id: 'w1',
        userId: USER,
        corpCode: CORP,
        corpName: '삼성전자',
        createdAt, // 20260612
        lastViewedAt: null,
        lastViewedRcpNo: null,
      },
    ];
    const disclosures: DiscRow[] = [
      { corpCode: CORP, rcpNo: '20260611000900', rcpDt: '20260611' }, // 등록 전날 → 제외
      { corpCode: CORP, rcpNo: '20260612000001', rcpDt: '20260612' }, // 등록 당일 → 신규
      { corpCode: CORP, rcpNo: '20260613000001', rcpDt: '20260613' }, // 다음 날 → 신규
    ];
    const service = await buildService(makeMockPrisma(watch, disclosures));
    expect((await service.findAll(USER)).items[0].newDisclosureCount).toBe(2);
  });

  it('빈 워치리스트는 항목 0, count 쿼리 없이 동작', async () => {
    const service = await buildService(makeMockPrisma([], []));
    const res = await service.findAll(USER);
    expect(res.items).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
