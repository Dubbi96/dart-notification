import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { QUEUE } from '../../common/queues/queue.constants';

/**
 * BullMQ(Redis) 도달성(readiness) 헬스 인디케이터 (DAR-111).
 *
 * AI_ANALYZE 큐의 Redis 클라이언트로 `PING` 만 보낸다 — 잡 적재/소비 없음.
 * 큐 미주입(Redis 미구성 환경/테스트)이면 도달성 미확인으로 down 표기.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    @Optional()
    @InjectQueue(QUEUE.AI_ANALYZE)
    private readonly queue: Queue | null = null,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.queue) {
      throw new HealthCheckError(
        'Redis/큐 미구성',
        this.getStatus(key, false, { message: '큐가 주입되지 않음' }),
      );
    }
    try {
      // bullmq 의 client 타입(IRedisClient)은 ping 을 노출하지 않으므로 ioredis 핑 시그니처로 좁힘.
      const client = (await this.queue.client) as unknown as {
        ping: () => Promise<string>;
      };
      const pong = await client.ping();
      return this.getStatus(key, true, { ping: pong });
    } catch (err) {
      throw new HealthCheckError(
        'Redis 도달 실패',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
