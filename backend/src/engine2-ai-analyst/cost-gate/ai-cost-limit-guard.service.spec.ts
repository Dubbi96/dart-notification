import { AiCostLimitGuardService } from './ai-cost-limit-guard.service';
import { AiCostLevel } from '../types/ai-analyst.types';
import { PrismaService } from '../../prisma/prisma.service';

describe('AiCostLimitGuardService', () => {
  function makeService(dailyCost: number, monthlyCost: number) {
    const mockPrisma = {
      aIUsageLog: {
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { costUsd: dailyCost } })
          .mockResolvedValueOnce({ _sum: { costUsd: monthlyCost } }),
      },
    } as unknown as PrismaService;
    return new AiCostLimitGuardService(mockPrisma);
  }

  it('한도 미달 시 forcedLevel=null', async () => {
    const svc = makeService(0.5, 10.0);
    const status = await svc.getLimitStatus();
    expect(status.forcedLevel).toBeNull();
    expect(status.dailyExceeded).toBe(false);
    expect(status.monthlyExceeded).toBe(false);
  });

  it('일 한도 초과 시 forcedLevel=L0, dailyExceeded=true', async () => {
    const svc = makeService(1.0, 5.0);
    const status = await svc.getLimitStatus();
    expect(status.dailyExceeded).toBe(true);
    expect(status.forcedLevel).toBe(AiCostLevel.L0);
  });

  it('월 한도 초과 시 forcedLevel=L0, monthlyExceeded=true', async () => {
    const svc = makeService(0.1, 20.0);
    const status = await svc.getLimitStatus();
    expect(status.monthlyExceeded).toBe(true);
    expect(status.forcedLevel).toBe(AiCostLevel.L0);
  });

  it('enforceLimit: 한도 초과 시 L2 → L0 강등', async () => {
    const svc = makeService(1.5, 5.0);
    const level = await svc.enforceLimit(AiCostLevel.L2);
    expect(level).toBe(AiCostLevel.L0);
  });

  it('enforceLimit: 한도 미달 시 원래 레벨 유지', async () => {
    const svc = makeService(0.1, 5.0);
    const level = await svc.enforceLimit(AiCostLevel.L3);
    expect(level).toBe(AiCostLevel.L3);
  });
});
