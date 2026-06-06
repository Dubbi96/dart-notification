import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '../common/queues/queue.constants';
import { GraduationModule } from '../engine5-trading-risk/simulation/graduation.module';
import { OpsHealthController } from './ops-health.controller';
import { OpsMetricsController } from './ops-metrics.controller';
import { OpsMetricsService } from './ops-metrics.service';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { ExternalKeysHealthIndicator } from './indicators/external-keys-health.indicator';

/**
 * OpsModule — 운영 헬스/메트릭 엔드포인트 (DAR-111, 패널 v5 #6, 안전/운영).
 *
 * GET /health(·/live) — terminus 기반 readiness/liveness(DB·Redis 도달성 + 외부키 경량 점검).
 * GET /ops/metrics    — 경량 JSON 핵심 카운터(AI누적·신호·모의포지션·freshness·졸업지표).
 *
 * 배선:
 *  - TerminusModule: HealthCheckService 제공.
 *  - BullModule.registerQueue(AI_ANALYZE): RedisHealthIndicator 가 큐의 Redis 클라이언트로 PING.
 *  - GraduationModule: GraduationMetricsService(G1/G2/G3/G5) 재사용.
 *  - PrismaModule(@Global)·CronHealthModule(@Global, DataFreshnessService)는 import 불요.
 *
 * ★ read-only 관측 — 신규 수집·외부 실호출·체결·AI 개입 0. 마이그레이션 0.
 *   ★실주문/Kill Switch 무직결. 외부키 readiness 는 키 존재/형식 확인 수준(쿼터 소모 0).
 */
@Module({
  imports: [
    TerminusModule,
    BullModule.registerQueue({ name: QUEUE.AI_ANALYZE }),
    GraduationModule,
  ],
  controllers: [OpsHealthController, OpsMetricsController],
  providers: [
    OpsMetricsService,
    PrismaHealthIndicator,
    RedisHealthIndicator,
    ExternalKeysHealthIndicator,
  ],
})
export class OpsModule {}
