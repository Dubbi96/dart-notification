import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { ExternalKeysHealthIndicator } from './indicators/external-keys-health.indicator';

/**
 * 운영 헬스 엔드포인트 (DAR-111) — @nestjs/terminus 기반.
 *
 * GET /health        — readiness: DB·BullMQ(Redis) 도달성 + 외부키(가벼운 존재/형식) 점검.
 * GET /health/live   — liveness: 프로세스 응답 가능 여부(외부 의존 점검 없음).
 *
 * ★외부키 readiness 는 키 존재/형식 확인 수준(실호출·쿼터 소모 0).
 * ★인증 미적용(probe 는 인증 불가) — 비밀값 미노출(도달성 boolean·키 구성여부만).
 *   운영/내부용 — 프로덕션 노출 범위는 게이트웨이/네트워크에서 제한 권장.
 *
 * ★@SkipThrottle (DAR-254) — k8s/LB liveness·readiness 프로브는 동일 IP에서
 *   분당 수십~수백회 호출되어 전역 ThrottlerModule(60req/min) 버킷을 소진,
 *   429 → 컨테이너 unhealthy 오판 → 재시작 루프를 유발한다. 프로브 경로는
 *   throttle 대상에서 제외(일반 API throttle 은 유지). 인증·외부호출 없는
 *   read-only 도달성 점검이라 throttle 면제의 보안 영향 없음.
 */
@ApiTags('Ops')
@SkipThrottle()
@Controller()
export class OpsHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly keysIndicator: ExternalKeysHealthIndicator,
  ) {}

  @Get('health')
  @HealthCheck()
  @ApiOperation({
    summary:
      'readiness 헬스체크 — DB·BullMQ(Redis) 도달성 + 외부키(DART/KRX/LLM) 키 존재/형식(실호출 없음). 운영/내부용',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.redisIndicator.isHealthy('redis'),
      () => this.keysIndicator.isHealthy('externalKeys'),
    ]);
  }

  @Get('health/live')
  @HealthCheck()
  @ApiOperation({
    summary: 'liveness 헬스체크 — 프로세스 응답 가능 여부(외부 의존 점검 없음)',
  })
  live(): Promise<HealthCheckResult> {
    // 외부 의존 없이 항상 통과 — 프로세스가 요청을 처리할 수 있음을 의미.
    return this.health.check([]);
  }
}
