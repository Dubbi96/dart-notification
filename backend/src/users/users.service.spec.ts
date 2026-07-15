// backend/src/users/users.service.spec.ts
// 갭분석 W1 — Pro 사전신청 서버 영속화 스펙.
//
// 기존 모바일 로컬 보관(useSettingsStore.proWaitlistOptIn)은 수요 데이터가 서버에
// 남지 않아 계측 불가였다. ProWaitlistEntry(userId @unique) 1행 upsert 로 전환하며,
// 핵심 계약은 멱등성이다: 신청을 몇 번 반복해도 행은 1개(최초 신청 시각 보존),
// 철회는 미신청 상태에서 호출해도 에러 없이 no-op.
//
// 인메모리 가짜 Prisma 는 @unique(userId) 제약과 upsert/deleteMany/findUnique 의
// 실제 의미(있으면 update, 없으면 create / 조건 일치 행 삭제)를 충실히 재현한다.

import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

interface WaitlistRow {
  id: string;
  userId: string;
  createdAt: Date;
}

function makeMockPrisma() {
  const rows: WaitlistRow[] = [];
  let seq = 0;

  const proWaitlistEntry = {
    upsert: async ({
      where,
      create,
    }: {
      where: { userId: string };
      create: { userId: string };
      update: Record<string, never>;
    }) => {
      const existing = rows.find((r) => r.userId === where.userId);
      if (existing) return existing; // update:{} → 변경 없이 기존 행 반환
      const row: WaitlistRow = {
        id: `wl-${++seq}`,
        userId: create.userId,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    deleteMany: async ({ where }: { where: { userId: string } }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].userId === where.userId) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
    findUnique: async ({ where }: { where: { userId: string } }) =>
      rows.find((r) => r.userId === where.userId) ?? null,
  };

  return { prisma: { proWaitlistEntry } as any, rows };
}

describe('UsersService — Pro 사전신청 (갭분석 W1)', () => {
  async function build() {
    const { prisma, rows } = makeMockPrisma();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return { service: moduleRef.get(UsersService), rows };
  }

  it('신청하면 optedIn=true 와 신청 시각을 돌려주고 행 1개가 남는다', async () => {
    const { service, rows } = await build();
    const res = await service.joinProWaitlist('u1');
    expect(res.optedIn).toBe(true);
    expect(res.createdAt).toBeInstanceOf(Date);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('u1');
  });

  it('★ 멱등성: 같은 사용자가 여러 번 신청해도 행은 1개, 최초 신청 시각이 보존된다', async () => {
    const { service, rows } = await build();
    const first = await service.joinProWaitlist('u1');
    const second = await service.joinProWaitlist('u1');
    const third = await service.joinProWaitlist('u1');

    expect(rows).toHaveLength(1);
    // upsert(update:{}) → createdAt 이 재신청으로 덮이지 않는다(최초 지불의사 시점 보존)
    expect(second.createdAt).toEqual(first.createdAt);
    expect(third.createdAt).toEqual(first.createdAt);
  });

  it('서로 다른 사용자는 각자 1행씩 남는다', async () => {
    const { service, rows } = await build();
    await service.joinProWaitlist('u1');
    await service.joinProWaitlist('u2');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set(['u1', 'u2']));
  });

  it('철회하면 행이 지워지고 optedIn=false 를 돌려준다', async () => {
    const { service, rows } = await build();
    await service.joinProWaitlist('u1');
    const res = await service.leaveProWaitlist('u1');
    expect(res).toEqual({ optedIn: false, createdAt: null });
    expect(rows).toHaveLength(0);
  });

  it('★ 철회 멱등성: 미신청 상태에서 철회해도 에러 없이 no-op', async () => {
    const { service, rows } = await build();
    await expect(service.leaveProWaitlist('u1')).resolves.toEqual({
      optedIn: false,
      createdAt: null,
    });
    expect(rows).toHaveLength(0);
  });

  it('철회는 본인 행만 지운다(다른 사용자 행 무손상)', async () => {
    const { service, rows } = await build();
    await service.joinProWaitlist('u1');
    await service.joinProWaitlist('u2');
    await service.leaveProWaitlist('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('u2');
  });

  it('조회: 신청 전 false/null → 신청 후 true+시각 → 철회 후 다시 false/null', async () => {
    const { service } = await build();

    expect(await service.getProWaitlistStatus('u1')).toEqual({
      optedIn: false,
      createdAt: null,
    });

    const joined = await service.joinProWaitlist('u1');
    expect(await service.getProWaitlistStatus('u1')).toEqual({
      optedIn: true,
      createdAt: joined.createdAt,
    });

    await service.leaveProWaitlist('u1');
    expect(await service.getProWaitlistStatus('u1')).toEqual({
      optedIn: false,
      createdAt: null,
    });
  });

  it('신청→철회→재신청 사이클이 정상 동작한다(행 1개, 새 신청 시각)', async () => {
    const { service, rows } = await build();
    const first = await service.joinProWaitlist('u1');
    await service.leaveProWaitlist('u1');
    // 시각 구분을 위해 1ms 대기(테스트 결정성 확보)
    await new Promise((r) => setTimeout(r, 2));
    const rejoined = await service.joinProWaitlist('u1');

    expect(rows).toHaveLength(1);
    expect(rejoined.optedIn).toBe(true);
    expect(rejoined.createdAt.getTime()).toBeGreaterThan(
      first.createdAt.getTime(),
    );
  });
});
