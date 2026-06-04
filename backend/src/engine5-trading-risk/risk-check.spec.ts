// risk-check.spec.ts — Risk 하드룰·veto·Kill Switch fixture 테스트 (M11, DAR-18)
// AI 금지영역: 이 테스트 파일에 AI import 없음.

import { checkRisk } from './domain/risk-check.service';
import {
  RiskCheckInput,
  DEFAULT_RISK_LIMITS,
  RiskLimits,
} from './domain/risk-check.types';
import { checkAutoKill, KillSwitchManager } from './domain/kill-switch';
import {
  evaluateEventGate,
  isWhitelisted,
  isBlacklisted,
  WHITELIST_EVENTS,
  BLACKLIST_EVENTS,
} from './domain/event-list';
import { OrderRiskService } from './services/order-risk.service';
import { InMemoryAuditLogRepository } from './repositories/in-memory-audit-log.repository';

// ─── 테스트 픽스처 ─────────────────────────────────────────────

function baseInput(overrides: Partial<RiskCheckInput> = {}): RiskCheckInput {
  return {
    corpCode: 'A005930',
    stockCode: '005930',
    side: 'BUY',
    requestedShares: 2,
    limitPrice: 70000,        // 주문금액: 140,000 KRW = 1.4% (3% 한도 이내)
    totalCapital: 10_000_000, // 총자산: 1000만 KRW
    currentPositionValue: 0,
    dailyPnl: 0,
    weeklyPnl: 0,
    openOrderCount: 0,
    todayTradeCount: 0,
    killSwitchActive: false,
    ...overrides,
  };
}

// ─── 1. Kill Switch ────────────────────────────────────────────

describe('Kill Switch', () => {
  it('Kill Switch 비활성 시 다른 룰로 판정', () => {
    const result = checkRisk(baseInput({ killSwitchActive: false }));
    expect(result.approved).toBe(true);
  });

  it('Kill Switch 활성 시 즉시 거부 (단독)', () => {
    const result = checkRisk(baseInput({ killSwitchActive: true }));
    expect(result.approved).toBe(false);
    expect(result.violations[0].code).toBe('KILL_SWITCH_ACTIVE');
    expect(result.violations).toHaveLength(1); // Kill Switch 외 다른 위반 검사 안 함
  });

  it('Kill Switch 활성 시 BuyScore 긍정이어도 거부 (veto)', () => {
    const result = checkRisk(baseInput({ killSwitchActive: true, buyScore: 5 }));
    expect(result.approved).toBe(false);
    expect(result.vetoed).toBe(true);
  });
});

// ─── 2. 1회 매수 한도 ─────────────────────────────────────────

describe('1회 매수 한도 (자본 3%)', () => {
  it('3% 이하 — 통과', () => {
    // 1000만 * 3% = 30만. 주문: 2주 * 70000 = 14만 ✓
    const result = checkRisk(baseInput({ requestedShares: 2, limitPrice: 70000 }));
    expect(result.violations.find((v) => v.code === 'SINGLE_BUY_LIMIT')).toBeUndefined();
  });

  it('3% 초과 — 거부', () => {
    // 5주 * 70000 = 350,000 → 3.5% > 3%
    const result = checkRisk(baseInput({ requestedShares: 5, limitPrice: 70000 }));
    expect(result.violations.find((v) => v.code === 'SINGLE_BUY_LIMIT')).toBeDefined();
    expect(result.approved).toBe(false);
  });

  it('경계값: 정확히 3%', () => {
    // 1000만 * 3% = 30만. 4주 * 75000 = 300,000 = 3.0% → 정확히 3%, NOT > 3% → 통과
    const result = checkRisk(baseInput({ requestedShares: 4, limitPrice: 75000 }));
    expect(result.violations.find((v) => v.code === 'SINGLE_BUY_LIMIT')).toBeUndefined();
  });

  it('매도 시 1회 매수 한도 미적용', () => {
    // 매도는 단일 매수 한도 미적용
    const result = checkRisk(baseInput({ side: 'SELL', requestedShares: 1000, limitPrice: 70000 }));
    expect(result.violations.find((v) => v.code === 'SINGLE_BUY_LIMIT')).toBeUndefined();
  });
});

// ─── 3. 단일 종목 한도 ────────────────────────────────────────

describe('단일 종목 한도 (자본 10%)', () => {
  it('기존 포지션 8% + 신규 주문 1.4% = 9.4% — 통과 (10% 이내)', () => {
    // buy: 2 * 70,000 = 140,000 (1.4% ≤ 3% 매수한도), 기존: 800,000 (8%), 합계: 940,000 (9.4% ≤ 10%)
    const result = checkRisk(
      baseInput({ requestedShares: 2, limitPrice: 70000, currentPositionValue: 800_000 }),
    );
    expect(result.violations.find((v) => v.code === 'SINGLE_POSITION_LIMIT')).toBeUndefined();
  });

  it('기존 포지션 9% + 신규 주문 2% = 11% — 거부', () => {
    // buy: 2 * 70,000 = 140,000 (1.4%), 기존: 900,000 (9%), 합계: 1,040,000 (10.4% > 10%)
    const result = checkRisk(
      baseInput({
        requestedShares: 2,
        limitPrice: 70000,
        currentPositionValue: 900_000, // 9%
      }),
    );
    expect(result.violations.find((v) => v.code === 'SINGLE_POSITION_LIMIT')).toBeDefined();
  });

  it('매도 시 단일 종목 한도 미적용', () => {
    const result = checkRisk(
      baseInput({ side: 'SELL', currentPositionValue: 2_000_000, requestedShares: 1 }),
    );
    expect(result.violations.find((v) => v.code === 'SINGLE_POSITION_LIMIT')).toBeUndefined();
  });
});

// ─── 4. 일간 손실 한도 ────────────────────────────────────────

describe('일간 손실 한도 (-2%)', () => {
  it('손실 없음 — 통과', () => {
    const result = checkRisk(baseInput({ dailyPnl: 0 }));
    expect(result.violations.find((v) => v.code === 'DAILY_LOSS_LIMIT')).toBeUndefined();
  });

  it('-1.9% — 통과', () => {
    const result = checkRisk(baseInput({ dailyPnl: -190_000 }));
    expect(result.violations.find((v) => v.code === 'DAILY_LOSS_LIMIT')).toBeUndefined();
  });

  it('-2% 초과 (-200,001) — 거부', () => {
    const result = checkRisk(baseInput({ dailyPnl: -200_001 }));
    expect(result.violations.find((v) => v.code === 'DAILY_LOSS_LIMIT')).toBeDefined();
    expect(result.approved).toBe(false);
  });

  it('경계값: 정확히 -2% — 통과 (strictly <)', () => {
    const result = checkRisk(baseInput({ dailyPnl: -200_000 }));
    // -200,000 / 10,000,000 = -0.02, NOT < -0.02 → 통과
    expect(result.violations.find((v) => v.code === 'DAILY_LOSS_LIMIT')).toBeUndefined();
  });
});

// ─── 5. 주간 손실 한도 ────────────────────────────────────────

describe('주간 손실 한도 (-5%)', () => {
  it('-4.9% — 통과', () => {
    const result = checkRisk(baseInput({ weeklyPnl: -490_000 }));
    expect(result.violations.find((v) => v.code === 'WEEKLY_LOSS_LIMIT')).toBeUndefined();
  });

  it('-5% 초과 — 거부', () => {
    const result = checkRisk(baseInput({ weeklyPnl: -500_001 }));
    expect(result.violations.find((v) => v.code === 'WEEKLY_LOSS_LIMIT')).toBeDefined();
  });
});

// ─── 6. 중복·과매매 방지 ──────────────────────────────────────

describe('중복 주문 방지 (미체결 주문)', () => {
  it('미체결 4건 — 통과 (한도 5)', () => {
    const result = checkRisk(baseInput({ openOrderCount: 4 }));
    expect(result.violations.find((v) => v.code === 'DUPLICATE_ORDER')).toBeUndefined();
  });

  it('미체결 5건 — 거부 (≥5)', () => {
    const result = checkRisk(baseInput({ openOrderCount: 5 }));
    expect(result.violations.find((v) => v.code === 'DUPLICATE_ORDER')).toBeDefined();
  });
});

describe('과매매 방지 (일간 최대 거래)', () => {
  it('오늘 9건 — 통과 (한도 10)', () => {
    const result = checkRisk(baseInput({ todayTradeCount: 9 }));
    expect(result.violations.find((v) => v.code === 'OVER_TRADING')).toBeUndefined();
  });

  it('오늘 10건 — 거부 (≥10)', () => {
    const result = checkRisk(baseInput({ todayTradeCount: 10 }));
    expect(result.violations.find((v) => v.code === 'OVER_TRADING')).toBeDefined();
  });
});

// ─── 7. Risk veto 우선순위 ────────────────────────────────────

describe('Risk veto — BuyScore 긍정이어도 Rule 위반 시 거부', () => {
  it('BuyScore=5 (강한 매수)이어도 일간 손실 한도 위반 → veto 거부', () => {
    const result = checkRisk(
      baseInput({ dailyPnl: -300_000, buyScore: 5 }),
    );
    expect(result.approved).toBe(false);
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toContain('BuyScore=5');
    expect(result.vetoReason).toContain('DAILY_LOSS_LIMIT');
  });

  it('BuyScore=3이어도 주간 손실 한도 위반 → veto 거부', () => {
    const result = checkRisk(
      baseInput({ weeklyPnl: -600_000, buyScore: 3 }),
    );
    expect(result.approved).toBe(false);
    expect(result.vetoed).toBe(true);
  });

  it('BuyScore=5이고 Rule 위반 없음 → 승인 (veto 없음)', () => {
    const result = checkRisk(baseInput({ buyScore: 5 }));
    expect(result.approved).toBe(true);
    expect(result.vetoed).toBe(false);
  });

  it('BuyScore 없고 Rule 위반 → 거부 (veto=false, 단순 거부)', () => {
    const result = checkRisk(baseInput({ dailyPnl: -300_000 }));
    expect(result.approved).toBe(false);
    expect(result.vetoed).toBe(false); // buyScore 없으면 veto 플래그 false
  });

  it('복합 위반: 일간손실 + 주간손실 + 단일매수 모두 표시', () => {
    const result = checkRisk(
      baseInput({
        requestedShares: 50,   // 50 * 70,000 = 350만 = 35% > 3% 매수한도
        dailyPnl: -300_000,
        weeklyPnl: -600_000,
        buyScore: 5,
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.vetoed).toBe(true);
  });
});

// ─── 8. 자동 Kill Switch ──────────────────────────────────────

describe('Kill Switch 자동 발동 조건', () => {
  it('연속 손실 5회 → 자동 Kill', () => {
    const result = checkAutoKill({ consecutiveLossCount: 5, marketDropPct: 0, apiErrorCount: 0 });
    expect(result.shouldKill).toBe(true);
    expect(result.triggerCode).toBe('CONSECUTIVE_LOSS');
  });

  it('연속 손실 4회 → 미발동', () => {
    const result = checkAutoKill({ consecutiveLossCount: 4, marketDropPct: 0, apiErrorCount: 0 });
    expect(result.shouldKill).toBe(false);
  });

  it('API 오류 3회 → 자동 Kill', () => {
    const result = checkAutoKill({ consecutiveLossCount: 0, marketDropPct: 0, apiErrorCount: 3 });
    expect(result.shouldKill).toBe(true);
    expect(result.triggerCode).toBe('API_ERROR');
  });

  it('시장 급락 -5% → 자동 Kill (조건 설정 시)', () => {
    const result = checkAutoKill(
      { consecutiveLossCount: 0, marketDropPct: -0.06, apiErrorCount: 0 },
      {
        consecutiveLossCount: 0,
        maxConsecutiveLoss: 5,
        marketDropPct: -0.05,   // -5% 임계값 설정
        maxApiErrors: 3,
        apiErrorCount: 0,
      },
    );
    expect(result.shouldKill).toBe(true);
    expect(result.triggerCode).toBe('MARKET_DROP');
  });
});

describe('KillSwitchManager', () => {
  it('초기 상태: 비활성', () => {
    const ks = new KillSwitchManager();
    expect(ks.isActive()).toBe(false);
  });

  it('수동 활성화 후 isActive=true', () => {
    const ks = new KillSwitchManager();
    ks.activate('테스트 이유', 'USER');
    expect(ks.isActive()).toBe(true);
    expect(ks.getState().triggeredBy).toBe('USER');
    expect(ks.getState().reason).toBe('테스트 이유');
  });

  it('비활성화 후 isActive=false', () => {
    const ks = new KillSwitchManager();
    ks.activate('이유', 'SYSTEM');
    ks.deactivate();
    expect(ks.isActive()).toBe(false);
  });

  it('autoCheck: 연속 손실 도달 시 자동 활성화', () => {
    const ks = new KillSwitchManager();
    ks.autoCheck({ consecutiveLossCount: 5, marketDropPct: 0, apiErrorCount: 0 });
    expect(ks.isActive()).toBe(true);
  });

  it('autoCheck: 이미 활성 시 중복 활성화 안 함', () => {
    const ks = new KillSwitchManager();
    ks.activate('first', 'USER');
    const before = ks.getState().activatedAt;
    ks.autoCheck({ consecutiveLossCount: 10, marketDropPct: 0, apiErrorCount: 0 });
    expect(ks.getState().activatedAt?.getTime()).toBe(before?.getTime());
  });
});

// ─── 9. 이벤트 화이트리스트/블랙리스트 ──────────────────────

describe('이벤트 게이트 (화이트리스트 6종 / 블랙리스트 9종)', () => {
  it('화이트리스트가 정확히 6종', () => {
    expect(WHITELIST_EVENTS).toHaveLength(6);
  });

  it('블랙리스트가 정확히 9종', () => {
    expect(BLACKLIST_EVENTS).toHaveLength(9);
  });

  it.each([
    'EARNINGS_BEAT',
    'REVENUE_GROWTH',
    'NEW_CONTRACT',
    'DIVIDEND_INCREASE',
    'SHARE_BUYBACK',
    'MANAGEMENT_BUYOUT',
  ] as const)('화이트리스트: %s → allowed=true', (kind) => {
    const result = evaluateEventGate(kind);
    expect(result.allowed).toBe(true);
    expect(isWhitelisted(kind)).toBe(true);
    expect(isBlacklisted(kind)).toBe(false);
  });

  it.each([
    'ACCOUNTING_FRAUD',
    'REGULATORY_ACTION',
    'DELISTING_RISK',
    'MAJOR_LITIGATION',
    'EARNINGS_MISS',
    'DIVIDEND_CUT',
    'CAPITAL_REDUCTION',
    'MANAGEMENT_SCANDAL',
    'TRADING_SUSPENSION',
  ] as const)('블랙리스트: %s → allowed=false', (kind) => {
    const result = evaluateEventGate(kind);
    expect(result.allowed).toBe(false);
    expect(isBlacklisted(kind)).toBe(true);
    expect(isWhitelisted(kind)).toBe(false);
  });

  it('모든 이벤트가 reason 포함', () => {
    [...WHITELIST_EVENTS, ...BLACKLIST_EVENTS].forEach((kind) => {
      const result = evaluateEventGate(kind);
      expect(result.reason).toBeTruthy();
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });
});

// ─── 10. OrderRiskService + Audit Log 통합 ───────────────────

describe('OrderRiskService — Risk veto + Audit Log', () => {
  let auditRepo: InMemoryAuditLogRepository;
  let killSwitch: KillSwitchManager;
  let service: OrderRiskService;

  beforeEach(() => {
    auditRepo = new InMemoryAuditLogRepository();
    killSwitch = new KillSwitchManager();
    service = new OrderRiskService(auditRepo, killSwitch);
  });

  function makeReq(overrides: Partial<Parameters<typeof service.evaluateOrder>[0]> = {}) {
    return {
      idempotencyKey: `key-${Date.now()}-${Math.random()}`,
      corpCode: 'A005930',
      stockCode: '005930',
      side: 'BUY' as const,
      requestedShares: 1,
      limitPrice: 70000,
      totalCapital: 10_000_000,
      currentPositionValue: 0,
      dailyPnl: 0,
      weeklyPnl: 0,
      openOrderCount: 0,
      todayTradeCount: 0,
      ...overrides,
    };
  }

  it('정상 주문 → approved=true, audit RISK_PASSED 기록', async () => {
    const res = await service.evaluateOrder(makeReq());
    expect(res.approved).toBe(true);

    const logs = await auditRepo.findAll();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('RISK_PASSED');
    expect(logs[0].actorKind).toBe('RISK_ENGINE');
  });

  it('위반 주문 → approved=false, audit RISK_REJECTED 기록', async () => {
    const res = await service.evaluateOrder(makeReq({ dailyPnl: -300_000 }));
    expect(res.approved).toBe(false);

    const logs = await auditRepo.findAll();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('RISK_REJECTED');
  });

  it('audit 기록 누락 0 — 연속 5회 요청 모두 기록', async () => {
    for (let i = 0; i < 5; i++) {
      await service.evaluateOrder(makeReq({ idempotencyKey: `key-${i}` }));
    }
    const logs = await auditRepo.findAll();
    expect(logs).toHaveLength(5);
  });

  it('veto 경로: BuyScore=5, 일간 손실 초과 → audit에 veto 기록', async () => {
    const res = await service.evaluateOrder(
      makeReq({ dailyPnl: -300_000, buyScore: 5 }),
    );
    expect(res.result.vetoed).toBe(true);

    const logs = await auditRepo.findAll();
    const meta = logs[0].meta as Record<string, unknown>;
    expect(meta?.vetoed).toBe(true);
    expect(meta?.buyScore).toBe(5);
  });

  it('수동 Kill Switch 활성화 → audit KILL_SWITCH_SET 기록', async () => {
    await service.activateKillSwitch('테스트 수동 발동');
    const logs = await auditRepo.findAll();
    expect(logs[0].action).toBe('KILL_SWITCH_SET');
    expect(service.isKillSwitchActive()).toBe(true);
  });

  it('Kill Switch 해제 → audit KILL_SWITCH_RESET 기록', async () => {
    await service.activateKillSwitch('이유');
    await service.deactivateKillSwitch();
    const logs = await auditRepo.findAll();
    expect(logs[1].action).toBe('KILL_SWITCH_RESET');
    expect(service.isKillSwitchActive()).toBe(false);
  });

  it('Kill Switch 활성 중 주문 → KILL_SWITCH_ACTIVE 위반 + audit 기록', async () => {
    await service.activateKillSwitch('테스트');
    const res = await service.evaluateOrder(makeReq());
    expect(res.approved).toBe(false);
    expect(res.result.violations[0].code).toBe('KILL_SWITCH_ACTIVE');

    const logs = await auditRepo.findAll();
    // KILL_SWITCH_SET + RISK_REJECTED
    expect(logs).toHaveLength(2);
    expect(logs[1].action).toBe('RISK_REJECTED');
  });

  it('커스텀 한도 적용 — 1% 매수 한도', async () => {
    const strictService = new OrderRiskService(auditRepo, killSwitch, {
      singleBuyMaxPct: 0.01,
    });
    // 1주 * 70000 = 70,000 = 0.7% → 1% 이하 → 통과
    const res1 = await strictService.evaluateOrder(makeReq({ requestedShares: 1 }));
    expect(res1.approved).toBe(true);

    // 2주 * 70000 = 140,000 = 1.4% → 1% 초과 → 거부
    const res2 = await strictService.evaluateOrder(makeReq({ requestedShares: 2 }));
    expect(res2.approved).toBe(false);
    expect(res2.result.violations.find((v) => v.code === 'SINGLE_BUY_LIMIT')).toBeDefined();
  });
});

// ─── 11. 커스텀 한도 테스트 ───────────────────────────────────

describe('RiskLimits 커스텀 파라미터', () => {
  const strictLimits: RiskLimits = {
    ...DEFAULT_RISK_LIMITS,
    singleBuyMaxPct: 0.01,          // 1%
    singlePositionMaxPct: 0.05,     // 5%
    dailyLossMaxPct: -0.01,         // -1%
    weeklyLossMaxPct: -0.03,        // -3%
    maxOpenOrders: 2,
    maxDailyTrades: 3,
  };

  it('커스텀 한도 1%: 1.5% 주문 → 거부', () => {
    const result = checkRisk(
      baseInput({ requestedShares: 2, limitPrice: 80000 }), // 160,000 = 1.6%
      strictLimits,
    );
    expect(result.violations.find((v) => v.code === 'SINGLE_BUY_LIMIT')).toBeDefined();
  });

  it('커스텀 과매매 한도 3: 3회째 → 거부', () => {
    const result = checkRisk(baseInput({ todayTradeCount: 3 }), strictLimits);
    expect(result.violations.find((v) => v.code === 'OVER_TRADING')).toBeDefined();
  });
});
