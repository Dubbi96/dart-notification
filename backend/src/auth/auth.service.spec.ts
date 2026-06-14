import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';

/**
 * DAR-207: refresh 토큰 무효화/회전(rotation) 검증.
 *
 * 실제 Postgres 없이도 회전·폐기 로직을 결정론적으로 재현하기 위해,
 * refresh_tokens 테이블 동작을 인메모리 Map 으로 충실히 모사한 가짜 Prisma 를 사용한다.
 * (findUnique by tokenHash / update by id / updateMany by userId+revokedAt:null / create)
 */

interface FakeRefreshRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

function createFakePrisma() {
  const rows = new Map<string, FakeRefreshRow>();
  let seq = 0;

  return {
    rows,
    refreshToken: {
      create: jest.fn(async ({ data }: any) => {
        const row: FakeRefreshRow = {
          id: `rt_${++seq}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          revokedAt: null,
          createdAt: new Date(),
        };
        if ([...rows.values()].some((r) => r.tokenHash === row.tokenHash)) {
          // tokenHash 유니크 제약 모사
          throw new Error('Unique constraint failed on tokenHash');
        }
        rows.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where: { tokenHash } }: any) => {
        return [...rows.values()].find((r) => r.tokenHash === tokenHash) ?? null;
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        const row = rows.get(id);
        if (!row) throw new Error('Record not found');
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows.values()) {
          if (row.userId !== where.userId) continue;
          if (where.revokedAt === null && row.revokedAt !== null) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      }),
    },
  };
}

function createService() {
  const prisma = createFakePrisma();
  // 토큰마다 고유 jti 가 부여되므로 payload.jti 를 그대로 토큰 문자열로 흘려보내
  // 결정론적이면서 호출마다 유일한 토큰을 만든다.
  const jwtService = {
    signAsync: jest.fn(async (payload: any, opts: any) => {
      if (opts.expiresIn === '15m') return `access_${payload.sub}`;
      return `refresh_${payload.sub}_${payload.jti}`;
    }),
  };
  const configService = {
    get: jest.fn((key: string) => `secret_${key}`),
  };
  const devicesService = {
    removeByToken: jest.fn(async () => undefined),
  };

  const service = new AuthService(
    prisma as any,
    jwtService as any,
    configService as any,
    devicesService as any,
  );
  return { service, prisma, jwtService, devicesService };
}

const USER_ID = 'user_1';
const EMAIL = 'a@b.com';

describe('AuthService refresh token rotation (DAR-207)', () => {
  it('발급 시 refresh 토큰의 SHA-256 해시(원문 비저장)를 영속화한다', async () => {
    const { service, prisma } = createService();
    const tokens = await (service as any).generateTokens(USER_ID, EMAIL);

    expect(prisma.rows.size).toBe(1);
    const row = [...prisma.rows.values()][0];
    const expectedHash = createHash('sha256')
      .update(tokens.refreshToken)
      .digest('hex');
    expect(row.tokenHash).toBe(expectedHash);
    expect(row.tokenHash).not.toBe(tokens.refreshToken); // 원문 미저장
    expect(row.revokedAt).toBeNull();
    expect(row.userId).toBe(USER_ID);
  });

  it('유효한 refresh 토큰으로 회전하면 새 토큰을 발급하고 구토큰을 폐기한다', async () => {
    const { service, prisma } = createService();
    const first = await (service as any).generateTokens(USER_ID, EMAIL);

    const rotated = await service.refresh(USER_ID, EMAIL, first.refreshToken);

    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    // 구토큰 행은 revoked, 신규 행은 유효
    const oldHash = createHash('sha256').update(first.refreshToken).digest('hex');
    const oldRow = [...prisma.rows.values()].find((r) => r.tokenHash === oldHash)!;
    expect(oldRow.revokedAt).not.toBeNull();
    expect(prisma.rows.size).toBe(2);
    const active = [...prisma.rows.values()].filter((r) => r.revokedAt === null);
    expect(active).toHaveLength(1);
  });

  it('회전 후 구토큰을 재사용하면 401이며 사용자의 모든 세션을 폐기한다 (reuse detection)', async () => {
    const { service, prisma } = createService();
    const first = await (service as any).generateTokens(USER_ID, EMAIL);
    const second = await service.refresh(USER_ID, EMAIL, first.refreshToken);

    // 폐기된 구토큰 재사용 시도
    await expect(
      service.refresh(USER_ID, EMAIL, first.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // 방어적으로 신규 토큰(second)까지 모두 폐기되어야 한다
    const secondHash = createHash('sha256')
      .update(second.refreshToken)
      .digest('hex');
    const secondRow = [...prisma.rows.values()].find(
      (r) => r.tokenHash === secondHash,
    )!;
    expect(secondRow.revokedAt).not.toBeNull();
    const active = [...prisma.rows.values()].filter((r) => r.revokedAt === null);
    expect(active).toHaveLength(0);
  });

  it('로그아웃 후 동일 refresh 토큰으로 갱신하면 401', async () => {
    const { service, devicesService } = createService();
    const tokens = await (service as any).generateTokens(USER_ID, EMAIL);

    await service.logout(USER_ID, 'ExponentPushToken[xyz]');
    expect(devicesService.removeByToken).toHaveBeenCalledWith(
      USER_ID,
      'ExponentPushToken[xyz]',
    );

    await expect(
      service.refresh(USER_ID, EMAIL, tokens.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('등록되지 않은 refresh 토큰은 401', async () => {
    const { service } = createService();
    await (service as any).generateTokens(USER_ID, EMAIL);

    await expect(
      service.refresh(USER_ID, EMAIL, 'refresh_unknown_token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('다른 사용자가 발급받은 토큰으로는 회전할 수 없다 (401)', async () => {
    const { service } = createService();
    const victim = await (service as any).generateTokens('user_victim', EMAIL);

    await expect(
      service.refresh(USER_ID, EMAIL, victim.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('만료된 refresh 토큰은 401', async () => {
    const { service, prisma } = createService();
    const tokens = await (service as any).generateTokens(USER_ID, EMAIL);
    // 저장된 행의 만료 시각을 과거로 강제
    const row = [...prisma.rows.values()][0];
    row.expiresAt = new Date(Date.now() - 1000);

    await expect(
      service.refresh(USER_ID, EMAIL, tokens.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout 은 디바이스 토큰 없이 호출해도 세션을 폐기한다', async () => {
    const { service } = createService();
    const tokens = await (service as any).generateTokens(USER_ID, EMAIL);

    await service.logout(USER_ID);

    await expect(
      service.refresh(USER_ID, EMAIL, tokens.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
