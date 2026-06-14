// backend/src/saved-disclosures/saved-disclosures.service.spec.ts
// create() 의 findUnique→create TOCTOU FK 에러매핑 회귀 스펙 (DAR-281)
//
// create() 는 (1)disclosure.findUnique 로 존재확인(없으면 404) 후
// (2)savedDisclosure.create(FK disclosureRcpNo) 한다. 선검증과 insert 사이에
// 해당 공시 행이 삭제·프루닝되는 경쟁(TOCTOU)에서는 create 가 FK 위반(P2003)을
// 던지는데, 이전 구현은 P2002(중복)만 매핑하고 P2003 은 그대로 흘려 500 으로
// 샜다. watchlist.service(DAR-261) 와 동일하게 P2003 → NotFoundException(404)
// 로 매핑함을 결정론적으로 검증한다(정상 저장/중복 409/미존재 404 회귀 포함).

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SavedDisclosuresService } from './saved-disclosures.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── 인메모리 가짜 Prisma ──────────────────────────────────────────────
//
// disclosure.findUnique 는 missingDisclosures 에 든 rcpNo 만 null(미존재)을
// 돌려준다. savedDisclosure.create 는 @@unique([userId, disclosureRcpNo])
// 중복 시 P2002, createThrowsP2003 옵션 시(선검증 통과 후 공시행 삭제 경쟁)
// FK 위반 P2003 을 던진다.
function makeMockPrisma(
  opts: {
    // 미존재로 취급할 rcpNo 집합(undefined → 모든 rcpNo 존재로 간주)
    missingDisclosures?: Set<string>;
    // 선검증 통과 후 insert 단계에서 FK 위반(P2003)이 나는 경쟁(TOCTOU) 시뮬레이션
    createThrowsP2003?: boolean;
  } = {},
) {
  const rows: Array<{
    id: string;
    userId: string;
    disclosureRcpNo: string;
    createdAt: Date;
  }> = [];

  const disclosure = {
    findUnique: async ({ where }: { where: { rcpNo: string } }) =>
      opts.missingDisclosures?.has(where.rcpNo)
        ? null
        : { rcpNo: where.rcpNo, title: `disclosure-${where.rcpNo}` },
  };

  const savedDisclosure = {
    create: async ({
      data,
    }: {
      data: { userId: string; disclosureRcpNo: string };
    }) => {
      // @@unique([userId, disclosureRcpNo]) → 중복 시 P2002
      if (
        rows.some(
          (r) =>
            r.userId === data.userId &&
            r.disclosureRcpNo === data.disclosureRcpNo,
        )
      ) {
        const e: any = new Error('Unique constraint failed');
        e.code = 'P2002';
        throw e;
      }
      // Disclosure(rcpNo) FK 위반(선검증과 insert 사이 공시 삭제 경쟁) 시뮬레이션
      if (opts.createThrowsP2003) {
        const e: any = new Error('Foreign key constraint failed');
        e.code = 'P2003';
        throw e;
      }
      const row = {
        id: `${data.userId}:${data.disclosureRcpNo}`,
        ...data,
        createdAt: new Date('2026-06-15T00:00:00.000Z'),
      };
      rows.push(row);
      return {
        ...row,
        disclosure: {
          rcpNo: data.disclosureRcpNo,
          title: `disclosure-${data.disclosureRcpNo}`,
        },
      };
    },
  };

  const prisma: any = { disclosure, savedDisclosure };
  return { prisma, rows };
}

describe('SavedDisclosuresService.create (DAR-281 TOCTOU P2003 → 4xx)', () => {
  async function build(opts?: Parameters<typeof makeMockPrisma>[0]) {
    const { prisma, rows } = makeMockPrisma(opts);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SavedDisclosuresService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return { service: moduleRef.get(SavedDisclosuresService), prisma, rows };
  }

  it('정상 저장은 생성된 항목을 반환한다(회귀)', async () => {
    const { service, rows } = await build();
    const result = await service.create('user-1', { rcpNo: '20260615000001' });
    expect(result.id).toBe('user-1:20260615000001');
    expect(rows).toHaveLength(1);
  });

  it('미존재 공시(선검증 findUnique null)는 NotFoundException(404)(회귀)', async () => {
    const { service } = await build({
      missingDisclosures: new Set(['20260615000099']),
    });
    await expect(
      service.create('user-1', { rcpNo: '20260615000099' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('동일 공시 중복(P2002)은 ConflictException(409) 으로 변환한다(회귀)', async () => {
    const { service } = await build();
    await service.create('user-1', { rcpNo: '20260615000001' });
    await expect(
      service.create('user-1', { rcpNo: '20260615000001' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('선검증 통과 후 insert 단계 P2003(TOCTOU) 도 NotFoundException(404) 으로 매핑한다', async () => {
    const { service, rows } = await build({ createThrowsP2003: true });
    await expect(
      service.create('user-1', { rcpNo: '20260615000001' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // 5xx 로 새지 않고(원시 P2003 Error 가 아님), 행도 남지 않는다.
    expect(rows).toHaveLength(0);
  });
});
