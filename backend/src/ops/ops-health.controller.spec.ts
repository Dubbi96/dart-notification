import 'reflect-metadata';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { OpsHealthController } from './ops-health.controller';

/**
 * DAR-254 — 헬스 프로브 @SkipThrottle 회귀 가드.
 *
 * 전역 ThrottlerModule(60req/min, APP_GUARD)이 k8s/LB 프로브 폭주를 429로 막아
 * 컨테이너 unhealthy 오판 → 재시작 루프를 유발하던 결함을, 컨트롤러 레벨
 * @SkipThrottle() 로 프로브 경로만 throttle 면제하여 해소했음을 검증한다.
 *
 * SkipThrottle()(기본 인자 { default: true })는 `THROTTLER_SKIP + 'default'`
 * 메타데이터를 대상에 true 로 심고, ThrottlerGuard 가 이 메타를 읽어 skip 한다.
 */
describe('OpsHealthController (DAR-254 @SkipThrottle)', () => {
  // SkipThrottle() 기본값 { default: true } → 메타키 = 'THROTTLER:SKIPdefault'.
  const SKIP_DEFAULT_KEY = `${THROTTLER_SKIP}default`;

  it('컨트롤러 클래스에 throttle-skip 메타가 부착되어 프로브가 버킷 면제된다', () => {
    const skip = Reflect.getMetadata(SKIP_DEFAULT_KEY, OpsHealthController);
    expect(skip).toBe(true);
  });

  it('컨트롤러 데코레이터라 모든 헬스 핸들러(check·live)에 일괄 적용된다', () => {
    // 클래스 레벨 메타는 ThrottlerGuard 가 핸들러+클래스 머지로 읽으므로
    // /health, /health/live 두 라우트 모두 skip 대상이 된다.
    const live = OpsHealthController.prototype.live;
    const check = OpsHealthController.prototype.check;
    expect(typeof live).toBe('function');
    expect(typeof check).toBe('function');
    // 클래스 자체에 skip 메타가 있어야 한다(핸들러별 부착이 아닌 일괄).
    expect(Reflect.getMetadata(SKIP_DEFAULT_KEY, OpsHealthController)).toBe(
      true,
    );
  });

  it('일반 컨트롤러(미부착)에는 skip 메타가 없어 throttle 이 유지된다', () => {
    class PlainController {}
    expect(
      Reflect.getMetadata(SKIP_DEFAULT_KEY, PlainController),
    ).toBeUndefined();
  });
});
