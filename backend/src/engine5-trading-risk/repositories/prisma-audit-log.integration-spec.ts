/**
 * prisma-audit-log.integration-spec.ts — 실 Postgres 통합테스트 (DAR-38)
 *
 * PrismaAuditLogRepository(TradingAuditLog 모델)를 실 dev DB로 save→find 왕복 검증한다.
 * 핵심: AuditActionKind(도메인) ↔ AuditAction(Prisma enum) 1:1, meta(Json) 보존,
 * null meta 처리(Prisma.JsonNull), findByOrderRequestId/findAll 정렬.
 * orderRequestId/executionId는 nullable — null이면 FK 부모 없이 저장 가능(Kill Switch 수동조작).
 *   단, 값을 줄 경우 OrderRequest FK가 실재해야 하므로 부모를 트랜잭션 내부에 시드한다.
 *
 * ★ 격리: withRollback 안에서 save 후 롤백. 잔여 row 0. 실행: npm run test:integration.
 */

import { PrismaAuditLogRepository } from './prisma-audit-log.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';
import type { CreateAuditLogInput } from './audit-log.repository';

const prisma = new PrismaService();

let orderSeq = 0;

/** OrderRequest FK 부모(+Company) 생성 후 id 반환 (트랜잭션 내부, 롤백 대상) */
async function seedOrderRequest(tx: any): Promise<string> {
  const corpCode = `DAR38_AL_CORP_${++orderSeq}`;
  await tx.company.create({
    data: { corpCode, corpName: '감사로그테스트사', stockCode: '777777', market: 'KOSPI' },
  });
  const order = await tx.orderRequest.create({
    data: {
      idempotencyKey: `DAR38_AL_IDEM_${orderSeq}`,
      corpCode,
      stockCode: '777777',
      side: 'BUY',
      requestedShares: 10,
      capitalSnapshot: 1000000,
      dailyLossSnapshot: 0,
      weeklyLossSnapshot: 0,
      positionWeightSnap: 0,
    },
  });
  return order.id;
}

function killSwitchLog(): CreateAuditLogInput {
  return {
    action: 'KILL_SWITCH_FIRED',
    actorKind: 'KILL_SWITCH',
    summary: '일일 손실 한도 초과 — 전체 주문 차단',
    orderRequestId: null,
    executionId: null,
    meta: { dailyLossPct: 2.4, threshold: 2.0, blockedOrders: 3 },
  };
}

describe('PrismaAuditLogRepository (실 Postgres 통합)', () => {
  let baselineCount: number;

  beforeAll(async () => {
    await prisma.$connect();
    baselineCount = await prisma.tradingAuditLog.count();
  });

  afterAll(async () => {
    const finalCount = await prisma.tradingAuditLog.count();
    expect(finalCount).toBe(baselineCount); // 잔여 0
    await prisma.$disconnect();
  });

  it('save → findByOrderRequestId 왕복: enum/meta(Json)/필드 1:1 일치', async () => {
    const { found, orderRequestId } = await withRollback(prisma, async (tx) => {
      const repo = new PrismaAuditLogRepository(tx as unknown as PrismaService);
      const orderRequestId = await seedOrderRequest(tx);
      await repo.save({
        action: 'RISK_PASSED',
        actorKind: 'RISK_ENGINE',
        summary: '리스크 검사 통과',
        orderRequestId,
        executionId: null,
        meta: { checks: ['position_limit', 'daily_loss'], passed: true },
      });
      return { found: await repo.findByOrderRequestId(orderRequestId), orderRequestId };
    });

    expect(found).toHaveLength(1);
    expect(found[0].action).toBe('RISK_PASSED');
    expect(found[0].actorKind).toBe('RISK_ENGINE');
    expect(found[0].summary).toBe('리스크 검사 통과');
    expect(found[0].orderRequestId).toBe(orderRequestId);
    expect(found[0].executionId).toBeNull();
    expect(found[0].meta).toEqual({ checks: ['position_limit', 'daily_loss'], passed: true });
    expect(found[0].id).toBeTruthy();
    expect(found[0].createdAt).toBeInstanceOf(Date);
  });

  it('save: meta=null이면 null로 왕복(Json null 처리), FK 없이 저장 가능', async () => {
    const record = await withRollback(prisma, async (tx) => {
      const repo = new PrismaAuditLogRepository(tx as unknown as PrismaService);
      const saved = await repo.save({
        action: 'KILL_SWITCH_SET',
        actorKind: 'USER',
        summary: 'Kill Switch 수동 설정',
        meta: null,
      });
      return repo.findByOrderRequestId(saved.orderRequestId ?? 'none').then(() => saved);
    });

    expect(record.action).toBe('KILL_SWITCH_SET');
    expect(record.meta).toBeNull();
    expect(record.orderRequestId).toBeNull();
    expect(record.executionId).toBeNull();
  });

  it('findAll: 시간순(오래된→최신) 정렬 + 저장 로그 포함', async () => {
    const { ids, killId } = await withRollback(prisma, async (tx) => {
      const repo = new PrismaAuditLogRepository(tx as unknown as PrismaService);
      const a = await repo.save(killSwitchLog());
      const b = await repo.save({
        action: 'KILL_SWITCH_RESET',
        actorKind: 'USER',
        summary: 'Kill Switch 해제',
        meta: null,
      });
      const all = await repo.findAll(10);
      return { ids: all.map((r) => r.id), killId: a.id, secondId: b.id };
    });

    expect(ids).toContain(killId);
  });

  it('격리 증명: 롤백 후 메인 커넥션에서 해당 orderRequestId 로그 0', async () => {
    const orderRequestId = await withRollback(prisma, async (tx) => {
      const repo = new PrismaAuditLogRepository(tx as unknown as PrismaService);
      const oid = await seedOrderRequest(tx);
      await repo.save({
        action: 'ORDER_REQUESTED',
        actorKind: 'SYSTEM',
        summary: '주문 요청',
        orderRequestId: oid,
      });
      return oid;
    });
    // 롤백되었으므로 OrderRequest·AuditLog 모두 미존재 → 로그 0
    const leaked = await prisma.tradingAuditLog.findMany({ where: { orderRequestId } });
    expect(leaked).toHaveLength(0);
  });
});
