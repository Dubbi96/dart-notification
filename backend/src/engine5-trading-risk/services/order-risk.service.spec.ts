// backend/src/engine5-trading-risk/services/order-risk.service.spec.ts
// GAP-11: 위험축소(SELL) 주문 차단 해제 — side-gate 결정론 스펙
//   ① 킬스위치 REDUCE_ONLY(기본): 발동 중 SELL 통과·BUY 차단
//   ② 일/주 손실 한도: BUY 전용 — 한도 도달 중에도 SELL(청산) 통과
//   ③ SELL 무차별 허용 아님 — 잔여 하드룰(과매매 등)은 SELL 에도 그대로 적용
// AI 금지영역: 이 테스트 파일에 AI import 없음. 순수 Rule.

import { KillSwitchManager } from '../domain/kill-switch';
import { InMemoryAuditLogRepository } from '../repositories/in-memory-audit-log.repository';
import { OrderRiskService, OrderRiskRequest } from './order-risk.service';

function makeReq(overrides: Partial<OrderRiskRequest> = {}): OrderRiskRequest {
  return {
    idempotencyKey: 'idem-gap11',
    corpCode: 'A005930',
    stockCode: '005930',
    side: 'BUY',
    requestedShares: 1,
    limitPrice: 70000, // 70,000 KRW = 0.7% (매수 한도 3% 이내)
    totalCapital: 10_000_000,
    currentPositionValue: 0,
    dailyPnl: 0,
    weeklyPnl: 0,
    openOrderCount: 0,
    todayTradeCount: 0,
    ...overrides,
  };
}

describe('GAP-11 — Kill Switch REDUCE_ONLY (발동 중 SELL 허용·BUY 차단)', () => {
  let auditRepo: InMemoryAuditLogRepository;
  let killSwitch: KillSwitchManager;
  let service: OrderRiskService;

  beforeEach(async () => {
    auditRepo = new InMemoryAuditLogRepository();
    killSwitch = new KillSwitchManager();
    service = new OrderRiskService(auditRepo, killSwitch);
    await killSwitch.activate('연속 손실 5회', 'SYSTEM');
  });

  it('킬스위치 발동 중 SELL(위험 축소) → 통과', async () => {
    const res = await service.evaluateOrder(
      makeReq({ side: 'SELL', currentPositionValue: 700_000 }),
    );
    expect(res.approved).toBe(true);
    expect(
      res.result.violations.some((v) => v.code === 'KILL_SWITCH_ACTIVE'),
    ).toBe(false);
  });

  it('킬스위치 발동 중 BUY(신규 진입) → KILL_SWITCH_ACTIVE 차단 (불변)', async () => {
    const res = await service.evaluateOrder(makeReq({ side: 'BUY' }));
    expect(res.approved).toBe(false);
    expect(res.result.violations[0].code).toBe('KILL_SWITCH_ACTIVE');
  });

  it('발동 중 통과한 SELL 은 audit RISK_PASSED + REDUCE_ONLY 증적을 남긴다', async () => {
    await service.evaluateOrder(makeReq({ side: 'SELL' }));
    const logs = await auditRepo.findAll();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('RISK_PASSED');
    const meta = logs[0].meta as Record<string, unknown>;
    expect(meta?.killSwitchMode).toBe('REDUCE_ONLY');
    expect(meta?.killSwitchSellAllowed).toBe(true);
  });

  it('발동 중 SELL 이라도 잔여 하드룰(과매매)은 그대로 차단 — 무차별 허용 아님', async () => {
    const res = await service.evaluateOrder(
      makeReq({ side: 'SELL', todayTradeCount: 10 }),
    );
    expect(res.approved).toBe(false);
    expect(
      res.result.violations.some((v) => v.code === 'OVER_TRADING'),
    ).toBe(true);
    // 킬스위치 위반은 side-gate 로 미적용(REDUCE_ONLY)
    expect(
      res.result.violations.some((v) => v.code === 'KILL_SWITCH_ACTIVE'),
    ).toBe(false);
  });
});

describe('GAP-11 — 일/주 손실 한도는 BUY 전용 (SELL 청산 통과)', () => {
  let auditRepo: InMemoryAuditLogRepository;
  let service: OrderRiskService;

  beforeEach(() => {
    auditRepo = new InMemoryAuditLogRepository();
    service = new OrderRiskService(auditRepo, new KillSwitchManager());
  });

  it('일간 손실 한도(-2%) 초과 중 SELL → 통과 (위험 축소 허용)', async () => {
    const res = await service.evaluateOrder(
      makeReq({ side: 'SELL', dailyPnl: -300_000 }), // -3% < -2%
    );
    expect(res.approved).toBe(true);
    expect(
      res.result.violations.some((v) => v.code === 'DAILY_LOSS_LIMIT'),
    ).toBe(false);

    const logs = await auditRepo.findAll();
    expect(logs[0].action).toBe('RISK_PASSED');
  });

  it('주간 손실 한도(-5%) 초과 중 SELL → 통과', async () => {
    const res = await service.evaluateOrder(
      makeReq({ side: 'SELL', weeklyPnl: -600_000 }), // -6% < -5%
    );
    expect(res.approved).toBe(true);
    expect(
      res.result.violations.some((v) => v.code === 'WEEKLY_LOSS_LIMIT'),
    ).toBe(false);
  });

  it('일간 손실 한도 초과 중 BUY → DAILY_LOSS_LIMIT 차단 (회귀 가드)', async () => {
    const res = await service.evaluateOrder(
      makeReq({ side: 'BUY', dailyPnl: -300_000 }),
    );
    expect(res.approved).toBe(false);
    expect(
      res.result.violations.some((v) => v.code === 'DAILY_LOSS_LIMIT'),
    ).toBe(true);
  });

  it('손실 한도만 위반한 SELL + BuyScore 존재 → veto 아님(통과 재계산)', async () => {
    const res = await service.evaluateOrder(
      makeReq({ side: 'SELL', dailyPnl: -300_000, buyScore: 5 }),
    );
    expect(res.approved).toBe(true);
    expect(res.result.vetoed).toBe(false);
    expect(res.result.vetoReason).toBeUndefined();
  });

  it('SELL 이라도 손실 한도 외 위반(과매매)이 남으면 거부 + veto 재계산', async () => {
    const res = await service.evaluateOrder(
      makeReq({
        side: 'SELL',
        dailyPnl: -300_000,
        todayTradeCount: 10,
        buyScore: 5,
      }),
    );
    expect(res.approved).toBe(false);
    // 손실 한도 위반은 제거되고 잔여 위반만 남는다
    expect(res.result.violations.map((v) => v.code)).toEqual(['OVER_TRADING']);
    expect(res.result.vetoed).toBe(true);
    expect(res.result.vetoReason).toContain('OVER_TRADING');
    expect(res.result.vetoReason).not.toContain('DAILY_LOSS_LIMIT');
  });
});
