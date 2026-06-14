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

  /**
   * DAR-243 — 한도 윈도 경계가 KST 자정/월초(UTC 절대 시각)로 전달되는지 검증.
   * createdAt은 Prisma 기본 UTC 저장이므로 경계도 그 KST 벽시계 자정의 UTC 시각
   * 이어야 한다(로컬 setHours로 만든 UTC 자정이면 9시간 어긋난다).
   */
  describe('한도 윈도 경계 TZ (DAR-243)', () => {
    function makeSpyService() {
      const aggregate = jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } });
      const mockPrisma = {
        aIUsageLog: { aggregate },
      } as unknown as PrismaService;
      return { svc: new AiCostLimitGuardService(mockPrisma), aggregate };
    }

    it('createdAt gte 경계는 KST 자정/월초의 UTC 절대 시각', async () => {
      const { svc, aggregate } = makeSpyService();
      // 시스템 시계를 UTC 새벽(KST 06-15 03:00)으로 고정 — 옛 버그가 드러나는 구간.
      jest.useFakeTimers().setSystemTime(new Date('2026-06-14T18:00:00Z'));
      try {
        await svc.getLimitStatus();
      } finally {
        jest.useRealTimers();
      }

      const [dailyCall, monthlyCall] = aggregate.mock.calls;
      const dayStart: Date = dailyCall[0].where.createdAt.gte;
      const monthStart: Date = monthlyCall[0].where.createdAt.gte;

      // KST 06-15 00:00 = UTC 06-14 15:00 / KST 06-01 00:00 = UTC 05-31 15:00
      expect(dayStart.toISOString()).toBe('2026-06-14T15:00:00.000Z');
      expect(monthStart.toISOString()).toBe('2026-05-31T15:00:00.000Z');
      // 옛 로컬 setHours가 만들던 UTC 자정(00:00Z)이 아님을 못박는다.
      expect(dayStart.toISOString()).not.toBe('2026-06-15T00:00:00.000Z');
    });
  });
});
