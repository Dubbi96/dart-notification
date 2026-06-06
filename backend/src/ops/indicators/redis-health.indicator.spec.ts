import { Queue } from 'bullmq';
import { HealthCheckError } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis-health.indicator';

describe('RedisHealthIndicator (DAR-111)', () => {
  it('PING 성공 시 up', async () => {
    const queue = {
      client: Promise.resolve({ ping: jest.fn().mockResolvedValue('PONG') }),
    } as unknown as Queue;
    const indicator = new RedisHealthIndicator(queue);
    const result = await indicator.isHealthy('redis');
    expect(result.redis.status).toBe('up');
    expect(result.redis.ping).toBe('PONG');
  });

  it('큐 미주입(Redis 미구성) 시 HealthCheckError(down)', async () => {
    const indicator = new RedisHealthIndicator(null);
    await expect(indicator.isHealthy('redis')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('PING 실패 시 HealthCheckError(down)', async () => {
    const queue = {
      client: Promise.resolve({ ping: jest.fn().mockRejectedValue(new Error('timeout')) }),
    } as unknown as Queue;
    const indicator = new RedisHealthIndicator(queue);
    await expect(indicator.isHealthy('redis')).rejects.toBeInstanceOf(HealthCheckError);
  });
});
