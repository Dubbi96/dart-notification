import { HealthCheckError } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { PrismaService } from '../../prisma/prisma.service';

describe('PrismaHealthIndicator (DAR-111)', () => {
  it('SELECT 1 성공 시 up', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    const indicator = new PrismaHealthIndicator(prisma);
    const result = await indicator.isHealthy('database');
    expect(result.database.status).toBe('up');
  });

  it('쿼리 실패 시 HealthCheckError(down)', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaService;
    const indicator = new PrismaHealthIndicator(prisma);
    await expect(indicator.isHealthy('database')).rejects.toBeInstanceOf(HealthCheckError);
  });
});
