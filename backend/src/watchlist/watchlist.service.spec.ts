// backend/src/watchlist/watchlist.service.spec.ts
// create() 의 30 한도 동시성 원자화 회귀 스펙 (DAR-179)
//
// 운영 환경에서는 pg_advisory_xact_lock 이 같은 userId 의 추가를 직렬화한다.
// 단위 테스트에서는 그 직렬화 프리미티브를 충실히 모킹(per-userId async mutex,
// $executeRaw 에서 획득→트랜잭션 종료 시 해제)해, 실제 create() 코드 경로
// (트랜잭션 안의 count→임계검사→create→예외)가 병렬 호출에서 30 을 넘기지
// 않음을 결정론적으로 검증한다.

import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WatchlistService } from './watchlist.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── advisory lock 을 모델링하는 인메모리 가짜 Prisma ────────────────────────
//
// $transaction(fn) 은 tx 클라이언트를 만들어 fn 을 실행한다. tx.$executeRaw
// (= advisory lock 획득)는 userId 키별 직렬화 큐를 잡고, 트랜잭션이 끝나면
// finally 에서 해제한다 → pg_advisory_xact_lock 의 "트랜잭션 수명 동안 보유"
// 의미를 그대로 재현한다.
function makeMockPrisma(
  opts: {
    // 미존재로 취급할 corpCode 집합(undefined → 모든 corpCode 존재로 간주, 기존 테스트 호환)
    missingCompanies?: Set<string>;
    // 선검증 통과 후 insert 단계에서 FK 위반(P2003)이 나는 경쟁(TOCTOU) 시뮬레이션
    createThrowsP2003?: boolean;
  } = {},
) {
  const rows: Array<{ id: string; userId: string; corpCode: string }> = [];
  // userId → 현재 큐의 tail Promise (직전 보유자 해제까지 대기)
  const queues = new Map<string, Promise<void>>();

  // companies(corpCode) 하드 FK 의 존재 검증을 모델링한다. missingCompanies 에 든
  // corpCode 만 null 을 돌려주고(미존재), 나머지는 존재로 간주한다.
  const company = {
    findUnique: async ({
      where,
    }: {
      where: { corpCode: string };
    }) =>
      opts.missingCompanies?.has(where.corpCode)
        ? null
        : { corpCode: where.corpCode },
  };

  const watchList = {
    count: async ({ where }: { where: { userId: string } }) =>
      rows.filter((r) => r.userId === where.userId).length,
    create: async ({
      data,
    }: {
      data: { userId: string; corpCode: string; corpName: string };
    }) => {
      // @@unique([userId, corpCode]) → 중복 시 P2002
      if (
        rows.some(
          (r) => r.userId === data.userId && r.corpCode === data.corpCode,
        )
      ) {
        const e: any = new Error('Unique constraint failed');
        e.code = 'P2002';
        throw e;
      }
      // companies(corpCode) FK 위반(선검증과 insert 사이 회사 삭제 경쟁) 시뮬레이션
      if (opts.createThrowsP2003) {
        const e: any = new Error('Foreign key constraint failed');
        e.code = 'P2003';
        throw e;
      }
      const row = { id: `${data.userId}:${data.corpCode}`, ...data };
      rows.push(row);
      return row;
    },
  };

  const prisma: any = {
    company,
    watchList,
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const tx: any = { company, watchList, _release: null };
      tx.$executeRaw = async (_strings: TemplateStringsArray, key: string) => {
        // 키별 mutex: 직전 보유자가 해제할 때까지 대기 후 점유
        const prev = queues.get(key) ?? Promise.resolve();
        let releaseMine!: () => void;
        const mine = new Promise<void>((res) => (releaseMine = res));
        queues.set(
          key,
          prev.then(() => mine),
        );
        await prev;
        tx._release = releaseMine;
        return 1;
      };
      try {
        return await fn(tx);
      } finally {
        if (tx._release) tx._release(); // 트랜잭션 종료 = advisory lock 해제
      }
    },
  };

  return { prisma, rows };
}

describe('WatchlistService.create (DAR-179 동시성 원자화)', () => {
  async function build(opts?: Parameters<typeof makeMockPrisma>[0]) {
    const { prisma, rows } = makeMockPrisma(opts);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WatchlistService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return { service: moduleRef.get(WatchlistService), prisma, rows };
  }

  it('한도 미만 단건 추가는 성공한다', async () => {
    const { service, rows } = await build();
    const item = await service.create('u1', {
      corpCode: '00000001',
      corpName: 'A',
    });
    expect(item.corpCode).toBe('00000001');
    expect(rows).toHaveLength(1);
  });

  it('병렬로 35건을 추가해도 30건만 성공하고 30을 넘지 않는다', async () => {
    const { service, rows } = await build();

    const results = await Promise.allSettled(
      Array.from({ length: 35 }, (_, i) =>
        service.create('u1', {
          corpCode: String(i).padStart(8, '0'),
          corpName: `회사${i}`,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(30);
    expect(rejected).toHaveLength(5);
    rejected.forEach((r) =>
      expect(r.reason).toBeInstanceOf(UnprocessableEntityException),
    );
    // 핵심 불변식: 실제 저장된 행이 한도를 초과하지 않는다
    expect(rows).toHaveLength(30);
    expect(rows.length).toBeLessThanOrEqual(30);
  });

  it('서로 다른 사용자는 각자 30까지 독립적으로 채울 수 있다', async () => {
    const { service, rows } = await build();

    await Promise.allSettled([
      ...Array.from({ length: 30 }, (_, i) =>
        service.create('u1', {
          corpCode: `1${String(i).padStart(7, '0')}`,
          corpName: `u1-${i}`,
        }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        service.create('u2', {
          corpCode: `2${String(i).padStart(7, '0')}`,
          corpName: `u2-${i}`,
        }),
      ),
    ]);

    expect(rows.filter((r) => r.userId === 'u1')).toHaveLength(30);
    expect(rows.filter((r) => r.userId === 'u2')).toHaveLength(30);
  });

  it('정확히 30건이 찬 뒤 추가는 UnprocessableEntityException', async () => {
    const { service } = await build();
    for (let i = 0; i < 30; i++) {
      await service.create('u1', {
        corpCode: String(i).padStart(8, '0'),
        corpName: `회사${i}`,
      });
    }
    await expect(
      service.create('u1', { corpCode: '99999999', corpName: '초과' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('동일 기업 중복(P2002)은 ConflictException 으로 변환한다', async () => {
    const { service } = await build();
    await service.create('u1', { corpCode: '00000001', corpName: 'A' });
    await expect(
      service.create('u1', { corpCode: '00000001', corpName: 'A' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// 미존재 corpCode(companies 하드 FK 위반)는 5xx 가 아니라 4xx(404) 로 매핑된다(DAR-261).
// DTO 는 8자리 형식만 검증할 뿐 존재를 보장하지 않으므로, 트랜잭션 안의 선검증과
// P2003 폴백이 잘못된 입력을 NotFoundException 으로 변환함을 결정론적으로 검증한다.
describe('WatchlistService.create (DAR-261 미존재 corpCode → 4xx)', () => {
  async function build(opts?: Parameters<typeof makeMockPrisma>[0]) {
    const { prisma, rows } = makeMockPrisma(opts);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WatchlistService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return { service: moduleRef.get<WatchlistService>(WatchlistService), rows };
  }

  it('미존재 corpCode 추가는 NotFoundException(404) 이고 행을 만들지 않는다', async () => {
    const { service, rows } = await build({
      missingCompanies: new Set(['99999999']),
    });
    await expect(
      service.create('u1', { corpCode: '99999999', corpName: '없는회사' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // 선검증에서 막혀 insert 자체가 일어나지 않는다(FK 위반 5xx 미발생).
    expect(rows).toHaveLength(0);
  });

  it('선검증 통과 후 insert 단계 P2003(TOCTOU) 도 NotFoundException(404) 으로 매핑한다', async () => {
    const { service, rows } = await build({ createThrowsP2003: true });
    await expect(
      service.create('u1', { corpCode: '00000001', corpName: 'A' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rows).toHaveLength(0);
  });

  it('존재하는 corpCode 추가는 기존대로 성공한다(회귀)', async () => {
    const { service, rows } = await build();
    const item = await service.create('u1', {
      corpCode: '00126380',
      corpName: '삼성전자',
    });
    expect(item.corpCode).toBe('00126380');
    expect(rows).toHaveLength(1);
  });
});
