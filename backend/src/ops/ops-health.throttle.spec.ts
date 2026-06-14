import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import { OpsHealthController } from './ops-health.controller';

/**
 * DAR-254 — 결정론적 동작 재현: 전역 ThrottlerGuard 가 헬스 프로브를 throttle 면제하는지
 * 직접 검증한다(supertest 미설치 → 가드 단위 구동).
 *
 * 결함 재현: ThrottlerModule(limit=2) 하에서 동일 IP 가 한도 초과로 호출하면
 *  - @SkipThrottle 미부착(PlainController)  → 한도 초과분이 429(canActivate=false/throw)
 *  - @SkipThrottle 부착(OpsHealthController) → 100회 폭주에도 전부 통과(no 429)
 */
describe('OpsHealthController throttle bypass (DAR-254 동작 재현)', () => {
  const storages: ThrottlerStorageService[] = [];

  afterEach(() => {
    // ThrottlerStorageService 는 TTL 스캔 타이머를 유지하므로 정리(열린 핸들 방지).
    storages.splice(0).forEach((s) => s.onApplicationShutdown());
  });

  // 한도를 2로 낮춰 폭주를 빠르고 결정론적으로 재현.
  const buildGuard = async (): Promise<ThrottlerGuard> => {
    const storage = new ThrottlerStorageService();
    storages.push(storage);
    const guard = new ThrottlerGuard(
      { throttlers: [{ ttl: 60000, limit: 2 }] },
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
    return guard;
  };

  // 동일 IP 단일 클라이언트를 모사하는 ExecutionContext.
  const ctxFor = (
    controllerClass: any,
    handler: (...args: any[]) => any,
  ): ExecutionContext => {
    const req: Record<string, any> = { ips: [], ip: '10.0.0.1', headers: {} };
    const res: Record<string, any> = { header: () => undefined };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => handler,
      getClass: () => controllerClass,
    } as unknown as ExecutionContext;
  };

  it('헬스 프로브(/health/live)는 100회 고빈도 호출에도 429 없이 통과한다', async () => {
    const guard = await buildGuard();
    const ctx = ctxFor(OpsHealthController, OpsHealthController.prototype.live);

    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(await guard.canActivate(ctx));
    }
    // limit=2 를 한참 넘는 100회에도 전부 허용 → 프로브 재시작루프 방지.
    expect(results.every((r) => r === true)).toBe(true);
  });

  it('대조군: @SkipThrottle 미부착 일반 라우트는 한도 초과 시 차단된다', async () => {
    class PlainController {
      handle(): string {
        return 'ok';
      }
    }
    const guard = await buildGuard();
    const ctx = ctxFor(PlainController, PlainController.prototype.handle);

    // limit=2: 1·2회는 통과, 3회째는 ThrottlerException(429) 발생.
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toThrow();
  });
});
