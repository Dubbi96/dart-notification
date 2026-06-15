import { Logger, UnauthorizedException } from '@nestjs/common';
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

  const client: any = {
    rows,
    // 인터랙티브 트랜잭션 모사: 콜백 시작 전 rows 스냅샷을 떠 두고,
    // 콜백이 throw 하면 스냅샷으로 되돌려(rollback) 원자성을 재현한다.
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
      const snapshot = new Map(
        [...rows.entries()].map(([k, v]) => [k, { ...v }] as const),
      );
      try {
        return await fn(client);
      } catch (e) {
        rows.clear();
        for (const [k, v] of snapshot) rows.set(k, v);
        throw e;
      }
    }),
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

  return client;
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

  it('DAR-279: 회전 중 신규 토큰 create 가 실패하면 구토큰 폐기까지 롤백되어 유효하게 남는다 (원자성)', async () => {
    const { service, prisma } = createService();
    const first = await (service as any).generateTokens(USER_ID, EMAIL);
    const oldHash = createHash('sha256').update(first.refreshToken).digest('hex');

    // 신규 토큰 영속화(create) 강제 실패 주입: DB 순단·제약·커넥션 드롭 모사.
    (prisma.refreshToken.create as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('injected create failure (e.g. connection drop)');
    });

    await expect(
      service.refresh(USER_ID, EMAIL, first.refreshToken),
    ).rejects.toThrow('injected create failure');

    // 트랜잭션 롤백으로 구토큰의 revokedAt 은 되돌아가 유효(미폐기) 상태여야 한다.
    const oldRow = [...prisma.rows.values()].find((r) => r.tokenHash === oldHash)!;
    expect(oldRow.revokedAt).toBeNull();
    // 신규 행은 생성되지 않았고, 활성 토큰은 여전히 구토큰 1개.
    expect(prisma.rows.size).toBe(1);
    const active = [...prisma.rows.values()].filter((r) => r.revokedAt === null);
    expect(active).toHaveLength(1);

    // 핵심 회귀 방지: 일시적 DB 오류가 강제 로그아웃으로 번지지 않는다.
    // 구토큰으로 재시도하면 reuse-detection(전 세션 폐기)이 아니라 정상 회전된다.
    const retried = await service.refresh(USER_ID, EMAIL, first.refreshToken);
    expect(retried.refreshToken).not.toBe(first.refreshToken);
    const activeAfter = [...prisma.rows.values()].filter((r) => r.revokedAt === null);
    expect(activeAfter).toHaveLength(1);
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

/**
 * DAR-280: 카카오 토큰교환 실패 경로의 로깅 위생.
 *
 * - console.* 우회 없이 NestJS Logger 경유로 기록한다.
 * - 민감정보(앱 키 KAKAO_REST_API_KEY·access_token·refresh_token·인가코드·전체
 *   페이로드)는 로그에 절대 노출되지 않고, error/error_description/status 만 남는다.
 * - 인증 실패 동작(UnauthorizedException·메시지)은 불변.
 */
describe('AuthService kakaoLogin 로깅 위생 (DAR-280)', () => {
  const KAKAO_KEY = 'secret_KAKAO_REST_API_KEY'; // createService configService 모킹값
  const AUTH_CODE = 'super-secret-authorization-code-xyz';
  const REDIRECT_URI = 'https://app.example.com/callback';

  let logSpy: jest.SpyInstance;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // 실제 표준에러 출력 억제 + 호출 인자 캡처.
    logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  function mockTokenFetchFailure() {
    originalFetch = globalThis.fetch;
    // 토큰교환 실패 응답: 카카오 에러필드 + (방어적으로) 토큰필드까지 포함시켜
    // 전체 페이로드 덤프가 아님을 입증한다.
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'authorization code not found',
        access_token: 'LEAKED_ACCESS_TOKEN',
        refresh_token: 'LEAKED_REFRESH_TOKEN',
      }),
    })) as unknown as typeof globalThis.fetch;
  }

  it('토큰교환 실패 시 console 이 아니라 Logger.error 경유로 기록한다', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockTokenFetchFailure();
    const { service } = createService();

    await expect(
      service.kakaoLogin(AUTH_CODE, REDIRECT_URI),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('로그에 status/error/error_description 만 남고 민감정보는 미노출', async () => {
    mockTokenFetchFailure();
    const { service } = createService();

    await expect(
      service.kakaoLogin(AUTH_CODE, REDIRECT_URI),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const [message, meta] = logSpy.mock.calls[0];
    expect(message).toBe('Kakao token exchange failed');
    expect(meta).toEqual({
      status: 401,
      error: 'invalid_grant',
      error_description: 'authorization code not found',
    });

    // 모든 로그 인자를 직렬화해 민감 문자열이 단 한 글자도 섞이지 않음을 검증.
    const serialized = JSON.stringify(logSpy.mock.calls);
    expect(serialized).not.toContain(KAKAO_KEY);
    expect(serialized).not.toContain(AUTH_CODE);
    expect(serialized).not.toContain('LEAKED_ACCESS_TOKEN');
    expect(serialized).not.toContain('LEAKED_REFRESH_TOKEN');
  });

  it('인증 실패 메시지는 불변(카카오 인증에 실패했습니다.)', async () => {
    mockTokenFetchFailure();
    const { service } = createService();

    await expect(service.kakaoLogin(AUTH_CODE, REDIRECT_URI)).rejects.toThrow(
      '카카오 인증에 실패했습니다.',
    );
  });
});

/**
 * DAR-297: 카카오 OAuth fetch 타임아웃.
 *
 * Node native fetch 는 기본 타임아웃이 없어 카카오 API hang 시 로그인 요청이
 * 무기한 매달린다. 두 fetch(토큰교환·유저정보) 에 AbortSignal.timeout 을 적용하고,
 * 타임아웃/네트워크 throw 를 기존 실패 경로(UnauthorizedException)로 매핑한다.
 * 정상 응답 동작은 불변.
 */
describe('AuthService kakaoLogin fetch 타임아웃 (DAR-297)', () => {
  const AUTH_CODE = 'auth-code-xyz';
  const REDIRECT_URI = 'https://app.example.com/callback';

  let originalFetch: typeof globalThis.fetch;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // kakaoFetch 실패 경로의 Logger.error 출력 억제.
    logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    logSpy.mockRestore();
  });

  // AbortSignal.timeout 초과 시 fetch 가 던지는 것과 동일한 형태의 에러.
  function timeoutError(): Error {
    const err = new Error('The operation timed out');
    err.name = 'TimeoutError';
    return err;
  }

  function okJson(body: unknown) {
    return { ok: true, status: 200, json: async () => body };
  }

  it('토큰교환 fetch 가 타임아웃하면 UnauthorizedException(카카오 인증 실패)으로 매핑', async () => {
    const fetchMock = jest.fn(async () => {
      throw timeoutError();
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const { service } = createService();

    await expect(service.kakaoLogin(AUTH_CODE, REDIRECT_URI)).rejects.toThrow(
      '카카오 인증에 실패했습니다.',
    );
    await expect(
      service.kakaoLogin(AUTH_CODE, REDIRECT_URI),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // 첫 fetch 가 signal: AbortSignal 로 호출됐는지(=타임아웃 적용) 입증.
    const init = (fetchMock.mock.calls[0] as any[])[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('유저정보 fetch 가 타임아웃하면 UnauthorizedException(사용자 정보)으로 매핑', async () => {
    // 1번째(토큰) 호출은 성공, 2번째(유저정보) 호출만 타임아웃.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(okJson({ access_token: 'tok' }))
      .mockImplementationOnce(async () => {
        throw timeoutError();
      });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const { service } = createService();

    await expect(service.kakaoLogin(AUTH_CODE, REDIRECT_URI)).rejects.toThrow(
      '카카오 사용자 정보를 가져올 수 없습니다.',
    );

    // 유저정보 fetch 에도 AbortSignal 이 적용됐는지 입증.
    const init = (fetchMock.mock.calls[1] as any[])[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('정상 응답 경로는 타임아웃 적용 후에도 불변(회귀)', async () => {
    const KAKAO_ID = 987654321;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(okJson({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        okJson({
          id: KAKAO_ID,
          kakao_account: {
            email: 'kakao@user.com',
            profile: { nickname: '카카오닉' },
          },
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    // 성공 경로에 필요한 user/watchList 모델을 가짜 prisma 에 보강.
    const { service, prisma } = createService();
    const createdUser = {
      id: 'kakao_user_1',
      email: 'kakao@user.com',
      name: '카카오닉',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    prisma.user = {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => createdUser),
      update: jest.fn(async () => createdUser),
    };
    prisma.watchList = { count: jest.fn(async () => 0) };

    const result = await service.kakaoLogin(AUTH_CODE, REDIRECT_URI);

    expect(result.user).toEqual({
      id: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      createdAt: createdUser.createdAt,
    });
    expect(result.isNewUser).toBe(true);
    expect(result.tokens.accessToken).toBe('access_kakao_user_1');
    // 두 fetch 모두 AbortSignal(타임아웃) 과 함께 호출됐다.
    expect(((fetchMock.mock.calls[0] as any[])[1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal,
    );
    expect(((fetchMock.mock.calls[1] as any[])[1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal,
    );
  });
});
