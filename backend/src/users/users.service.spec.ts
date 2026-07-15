import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  UsersService,
  USER_CASCADE_DELETE_RELATIONS,
  USER_EXPLICIT_DELETE_MODELS,
  USER_LOOSE_USERID_ANONYMIZE_MODELS,
} from './users.service';

/**
 * 갭분석 W3 — 계정 삭제(회원 탈퇴) 검증.
 *
 * 두 층으로 나눈다:
 * 1) 스키마 가드 — Prisma DMMF(schema.prisma 전수)와 서비스의 관계 커버리지 목록이
 *    일치하는지 강제한다. User 를 참조하는 관계가 새로 생겼는데 Cascade 도 아니고
 *    명시 삭제 목록에도 없으면 **이 스펙이 실패**한다(탈퇴 시 개인정보 잔존 사고 차단).
 * 2) 동작 — deleteMe 가 단일 트랜잭션에서 refresh 토큰 폐기 → 미강결합 userId 익명화
 *    → User 삭제를 수행하는지 가짜 Prisma 로 검증한다.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1) 스키마 가드 (DMMF)
// ────────────────────────────────────────────────────────────────────────────

describe('User 삭제 관계 커버리지 — 스키마 가드', () => {
  // User 를 FK 로 실제 참조하는(관계의 from 쪽) 모델 전수
  const userFkModels = Prisma.dmmf.datamodel.models
    .map((model) => ({
      name: model.name,
      relation: model.fields.find(
        (field) =>
          field.kind === 'object' &&
          field.type === 'User' &&
          (field.relationFromFields?.length ?? 0) > 0,
      ),
    }))
    .filter((entry): entry is { name: string; relation: Prisma.DMMF.Field } =>
      Boolean(entry.relation),
    );

  it('User FK 관계는 전부 Cascade 이거나 명시 삭제 목록에 있어야 한다 (신규 관계 누락 시 실패)', () => {
    const uncovered = userFkModels
      .filter((entry) => entry.relation.relationOnDelete !== 'Cascade')
      .map((entry) => entry.name)
      .filter((name) => !USER_EXPLICIT_DELETE_MODELS.includes(name));

    // 실패했다면: schema.prisma 에 Cascade 없는 User 관계가 추가된 것 —
    // USER_EXPLICIT_DELETE_MODELS 에 등록하고 deleteMe 트랜잭션에 명시 삭제를 추가하라.
    expect(uncovered).toEqual([]);
  });

  it('Cascade 관계 전수가 서비스 목록과 정확히 일치한다 (관계 추가/삭제 시 의식적 갱신 강제)', () => {
    const cascadeModelNames = userFkModels
      .filter((entry) => entry.relation.relationOnDelete === 'Cascade')
      .map((entry) => entry.name)
      .sort();

    expect(cascadeModelNames).toEqual([...USER_CASCADE_DELETE_RELATIONS].sort());
  });

  it('FK 미강결합 userId 보유 모델은 전부 익명화 목록에 있어야 한다 (계측 모델 신규 추가 시 실패)', () => {
    const fkModelNames = new Set(userFkModels.map((entry) => entry.name));
    const looseUserIdModels = Prisma.dmmf.datamodel.models
      .filter((model) => model.name !== 'User' && !fkModelNames.has(model.name))
      .filter((model) =>
        model.fields.some((field) => field.kind === 'scalar' && field.name === 'userId'),
      )
      .map((model) => model.name)
      .sort();

    // 실패했다면: FK 없이 userId 문자열만 보관하는 모델이 추가된 것 —
    // USER_LOOSE_USERID_ANONYMIZE_MODELS 와 LOOSE_USERID_ANONYMIZERS 에 익명화를 추가하라.
    expect(looseUserIdModels).toEqual([...USER_LOOSE_USERID_ANONYMIZE_MODELS].sort());
  });

  it('명시 삭제 목록이 비어있지 않게 되면 deleteMe 에 구현이 필요하다 (현재 스키마 기준 빈 목록)', () => {
    // 현재 스키마는 전 관계 Cascade — 이 값이 바뀌는 순간 위 첫 테스트와 함께
    // deleteMe 트랜잭션 3) 단계 구현 여부를 리뷰해야 한다.
    expect(USER_EXPLICIT_DELETE_MODELS).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2) deleteMe 동작 (가짜 Prisma)
// ────────────────────────────────────────────────────────────────────────────

interface FakeTx {
  refreshToken: { updateMany: jest.Mock };
  searchMissLog: { updateMany: jest.Mock };
  funnelEvent: { updateMany: jest.Mock };
  user: { delete: jest.Mock };
}

function createFakePrisma(options: { userExists: boolean }) {
  const callOrder: string[] = [];

  const tx: FakeTx = {
    refreshToken: {
      updateMany: jest.fn(async () => {
        callOrder.push('refreshToken.updateMany');
        return { count: 2 };
      }),
    },
    searchMissLog: {
      updateMany: jest.fn(async () => {
        callOrder.push('searchMissLog.updateMany');
        return { count: 1 };
      }),
    },
    funnelEvent: {
      updateMany: jest.fn(async () => {
        callOrder.push('funnelEvent.updateMany');
        return { count: 1 };
      }),
    },
    user: {
      delete: jest.fn(async () => {
        callOrder.push('user.delete');
        return { id: 'user-1' };
      }),
    },
  };

  const prisma = {
    user: {
      findUnique: jest.fn(async () => (options.userExists ? { id: 'user-1' } : null)),
    },
    $transaction: jest.fn(async (fn: (transaction: FakeTx) => Promise<unknown>) => fn(tx)),
  };

  return { prisma, tx, callOrder };
}

describe('UsersService.deleteMe', () => {
  beforeAll(() => {
    // 삭제 완료 로그가 테스트 출력을 오염시키지 않도록 무음화
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  function createService(options: { userExists: boolean }) {
    const fake = createFakePrisma(options);
    // 생성자 시그니처(PrismaService)만 충족하는 구조적 대역
    const service = new UsersService(fake.prisma as never);
    return { service, ...fake };
  }

  it('존재하지 않는 사용자는 NotFoundException — 트랜잭션 미실행', async () => {
    const { service, prisma } = createService({ userExists: false });

    await expect(service.deleteMe('ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('단일 트랜잭션에서 refresh 토큰 폐기 → userId 익명화 → User 삭제를 수행한다', async () => {
    const { service, prisma, tx, callOrder } = createService({ userExists: true });

    const result = await service.deleteMe('user-1');

    expect(result).toEqual({ deleted: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // refresh 토큰 전부 폐기 (활성 토큰만 revokedAt 스탬프)
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    // FK 미강결합 모델 전부 익명화 — 목록과 실제 호출의 1:1 대응
    expect(tx.searchMissLog.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { userId: null },
    });
    expect(tx.funnelEvent.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { userId: null },
    });
    expect(USER_LOOSE_USERID_ANONYMIZE_MODELS).toHaveLength(2);

    // User 삭제는 반드시 마지막 (Cascade 삭제 전에 폐기·익명화 선행)
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(callOrder[callOrder.length - 1]).toBe('user.delete');
    expect(callOrder[0]).toBe('refreshToken.updateMany');
  });

  it('트랜잭션 내부 실패 시 에러가 전파된다 (부분 삭제 커밋 방지)', async () => {
    const { service, tx } = createService({ userExists: true });
    tx.user.delete.mockRejectedValueOnce(new Error('FK violation'));

    await expect(service.deleteMe('user-1')).rejects.toThrow('FK violation');
  });
});
