/**
 * AutoTradingStatusService 단위 검증 (DAR-361)
 *
 * 결정론적으로 증명: ① 킬스위치 비활성 → 리스크게이트 NORMAL ② 활성 → BLOCKED + 사유
 * ③ 최근 주문 빈 배열 graceful ④ 주문 매핑·limit 전달 ⑤ executionEnabled 항상 false(정직 고지).
 * KillSwitchManager 는 레포 없이 실제 인스턴스(인메모리)로, Prisma 는 findMany 목으로 격리.
 */

import {
  AutoTradingStatusService,
  DEFAULT_RECENT_ORDER_LIMIT,
} from './auto-status.service';
import { KillSwitchManager } from '../domain/kill-switch';

type FindManyArgs = { take: number; orderBy: unknown; select: unknown };

function makePrisma(rows: unknown[]) {
  const findMany = jest.fn(async (_args: FindManyArgs) => rows);
  return {
    prisma: { orderRequest: { findMany } } as never,
    findMany,
  };
}

function makeOrderRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ord_1',
    stockCode: '005930',
    side: 'BUY',
    requestedShares: 10,
    status: 'REJECTED',
    rejectionReason: 'SINGLE_BUY_LIMIT',
    createdAt: new Date('2026-06-19T01:00:00.000Z'),
    ...over,
  };
}

describe('AutoTradingStatusService (DAR-361)', () => {
  it('킬스위치 비활성 → 리스크게이트 NORMAL·차단사유 없음', async () => {
    const ks = new KillSwitchManager(); // repo 미주입 = 인메모리, 기본 비활성
    const { prisma } = makePrisma([]);
    const svc = new AutoTradingStatusService(prisma, ks);

    const res = await svc.getStatus();

    expect(res.killSwitch.isActive).toBe(false);
    expect(res.killSwitch.reason).toBeNull();
    expect(res.killSwitch.activatedAt).toBeNull();
    expect(res.riskGate.blocked).toBe(false);
    expect(res.riskGate.status).toBe('NORMAL');
    expect(res.riskGate.blockedReason).toBeNull();
  });

  it('킬스위치 활성 → 리스크게이트 BLOCKED·발동 사유 전달', async () => {
    const ks = new KillSwitchManager();
    await ks.activate('연속 손실 5회', 'SYSTEM');
    const { prisma } = makePrisma([]);
    const svc = new AutoTradingStatusService(prisma, ks);

    const res = await svc.getStatus();

    expect(res.killSwitch.isActive).toBe(true);
    expect(res.killSwitch.reason).toBe('연속 손실 5회');
    expect(res.killSwitch.triggeredBy).toBe('SYSTEM');
    expect(res.killSwitch.activatedAt).not.toBeNull();
    expect(res.riskGate.blocked).toBe(true);
    expect(res.riskGate.status).toBe('BLOCKED');
    expect(res.riskGate.blockedReason).toBe('연속 손실 5회');
  });

  it('최근 주문 없음 → 빈 배열 graceful', async () => {
    const ks = new KillSwitchManager();
    const { prisma } = makePrisma([]);
    const svc = new AutoTradingStatusService(prisma, ks);

    const res = await svc.getStatus();

    expect(res.recentOrders).toEqual([]);
  });

  it('최근 주문 매핑: 상태·사유·시각·종목 노출', async () => {
    const ks = new KillSwitchManager();
    const { prisma } = makePrisma([
      makeOrderRow(),
      makeOrderRow({
        id: 'ord_2',
        status: 'EXECUTED',
        rejectionReason: null,
        side: 'SELL',
      }),
    ]);
    const svc = new AutoTradingStatusService(prisma, ks);

    const res = await svc.getStatus();

    expect(res.recentOrders).toHaveLength(2);
    expect(res.recentOrders[0]).toEqual({
      id: 'ord_1',
      stockCode: '005930',
      side: 'BUY',
      requestedShares: 10,
      status: 'REJECTED',
      reason: 'SINGLE_BUY_LIMIT',
      createdAt: '2026-06-19T01:00:00.000Z',
    });
    expect(res.recentOrders[1].status).toBe('EXECUTED');
    expect(res.recentOrders[1].reason).toBeNull();
    expect(res.recentOrders[1].side).toBe('SELL');
  });

  it('recentLimit 을 최신순 take 로 prisma 에 전달', async () => {
    const ks = new KillSwitchManager();
    const { prisma, findMany } = makePrisma([]);
    const svc = new AutoTradingStatusService(prisma, ks);

    await svc.getStatus(7);

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as FindManyArgs;
    expect(args.take).toBe(7);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('기본 limit 은 DEFAULT_RECENT_ORDER_LIMIT', async () => {
    const ks = new KillSwitchManager();
    const { prisma, findMany } = makePrisma([]);
    const svc = new AutoTradingStatusService(prisma, ks);

    await svc.getStatus();

    const args = findMany.mock.calls[0][0] as FindManyArgs;
    expect(args.take).toBe(DEFAULT_RECENT_ORDER_LIMIT);
  });

  it('executionEnabled 는 항상 false·정직 고지 동봉(M11 미가동)', async () => {
    const ks = new KillSwitchManager();
    const { prisma } = makePrisma([]);
    const svc = new AutoTradingStatusService(prisma, ks);

    const res = await svc.getStatus();

    expect(res.executionEnabled).toBe(false);
    expect(res.notice).toContain('준비중');
    expect(typeof res.asOf).toBe('string');
  });
});
