/**
 * exit-engine.spec.ts — M8 Exit Engine Fixture 테스트 (DAR-12)
 *
 * 실제 DB/AI 없이 순수 Rule 함수·도메인 로직만 검증.
 * AI 금지영역: Exit Score·트리거·5액션 계산에 AI 개입 절대 금지.
 */

import {
  scoreToAction,
  calcLossRiskScore,
  calcThesisBreakScore,
  calcChartBreakScore,
  calcTimeExceededScore,
  calcOverweightScore,
  calcPositiveMomentumBonus,
  calculateExitScore,
  evaluateInvalidCondition,
  calcDisclosureRiskScore,
  isLargeInsiderNetSell,
  HIGH_RISK_EVENT_TYPES,
} from './domain/exit-score.calculator';
import { ExitEngineService, IPositionProvider } from './services/exit-engine.service';
import { InMemoryExitSignalRepository } from './repositories/in-memory-exit-signal.repository';
import type {
  PositionSnapshot,
  TechnicalSnapshot,
  ThesisSnapshot,
  DisclosureEvent,
  InsiderFlowSnapshot,
  InsiderTradeSnapshot,
} from './domain/exit-engine.types';

// ─── Fixture helpers ─────────────────────────────────────────────────

function makePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: 'pos-001',
    corpCode: '00126380',
    stockCode: '005930',
    entryPrice: 70000,
    quantity: 10,
    entryAmount: 700000,
    currentPrice: 70000,
    highestPrice: null,
    stopLossPct: null,
    takeProfitPct: null,
    maxHoldDays: null,
    entryDate: new Date(Date.now() - 2 * 86400000), // 2 days ago
    // 10 * 70000 = 700000 = 7% of 10,000,000 — within default 10% limit
    portfolioTotalValue: 10000000,
    portfolioMaxSinglePositionPct: 10.0,
    portfolioMaxSectorPct: 30.0,
    portfolioMaxDailyLossPct: 2.0,
    portfolioDailyLossPct: null,
    ...overrides,
  };
}

function makeTech(overrides: Partial<TechnicalSnapshot> = {}): TechnicalSnapshot {
  return {
    closePrice: 70000,
    openPrice: 70000,
    ma5: null,
    ma20: null,
    low20: null,
    vwap: null,
    atr14: null,
    volumeRatio3d: null,
    excessReturn5d: null,
    avgVolumeRatio5d: null,
    ...overrides,
  };
}

function makeThesis(overrides: Partial<ThesisSnapshot> = {}): ThesisSnapshot {
  return {
    invalidConditions: [],
    maxHoldDays: null,
    ...overrides,
  };
}

// ─── 1. scoreToAction — 5 thresholds ─────────────────────────────────

describe('scoreToAction', () => {
  it('score 0 → HOLD', () => {
    expect(scoreToAction(0)).toBe('HOLD');
  });

  it('score 29 → HOLD', () => {
    expect(scoreToAction(29)).toBe('HOLD');
  });

  it('score 30 → WATCH', () => {
    expect(scoreToAction(30)).toBe('WATCH');
  });

  it('score 49 → WATCH', () => {
    expect(scoreToAction(49)).toBe('WATCH');
  });

  it('score 50 → REDUCE', () => {
    expect(scoreToAction(50)).toBe('REDUCE');
  });

  it('score 69 → REDUCE', () => {
    expect(scoreToAction(69)).toBe('REDUCE');
  });

  it('score 70 → EXIT', () => {
    expect(scoreToAction(70)).toBe('EXIT');
  });

  it('score 89 → EXIT', () => {
    expect(scoreToAction(89)).toBe('EXIT');
  });

  it('score 90 → BLOCK_REBUY', () => {
    expect(scoreToAction(90)).toBe('BLOCK_REBUY');
  });

  it('score 100 → BLOCK_REBUY', () => {
    expect(scoreToAction(100)).toBe('BLOCK_REBUY');
  });
});

// ─── 2. calcLossRiskScore ─────────────────────────────────────────────

describe('calcLossRiskScore', () => {
  it('stopLossPct triggered → score=20, triggered=true', () => {
    const pos = makePosition({ entryPrice: 70000, stopLossPct: 8 });
    const tech = makeTech({ closePrice: 64000 }); // -8.57% > -8%
    const result = calcLossRiskScore(pos, tech);
    expect(result.score).toBe(20);
    expect(result.triggered).toBe(true);
  });

  it('stopLossPct exactly at threshold → triggered', () => {
    const pos = makePosition({ entryPrice: 70000, stopLossPct: 8 });
    const tech = makeTech({ closePrice: 70000 * (1 - 0.08) }); // exactly -8%
    const result = calcLossRiskScore(pos, tech);
    expect(result.score).toBe(20);
    expect(result.triggered).toBe(true);
  });

  it('ATR stop triggered → score=15, triggered=true', () => {
    const pos = makePosition({ entryPrice: 70000, stopLossPct: null });
    // atrStop = 70000 - 1.5 * 2000 = 67000; currentPrice = 66000 < 67000
    const tech = makeTech({ closePrice: 66000, atr14: 2000 });
    const result = calcLossRiskScore(pos, tech);
    expect(result.score).toBe(15);
    expect(result.triggered).toBe(true);
  });

  it('no triggers → score=0, triggered=false (HOLD)', () => {
    const pos = makePosition({ entryPrice: 70000, stopLossPct: 8 });
    const tech = makeTech({ closePrice: 70000 }); // 0% change, no stop hit
    const result = calcLossRiskScore(pos, tech);
    expect(result.score).toBe(0);
    expect(result.triggered).toBe(false);
  });

  it('portfolio daily loss limit exceeded → adds score', () => {
    const pos = makePosition({
      entryPrice: 70000,
      stopLossPct: null,
      portfolioMaxDailyLossPct: 2.0,
      portfolioDailyLossPct: -2.5, // exceeded
    });
    const tech = makeTech({ closePrice: 70000, atr14: null });
    const result = calcLossRiskScore(pos, tech);
    expect(result.score).toBeGreaterThan(0);
    expect(result.triggered).toBe(true);
  });
});

// ─── 3. calcThesisBreakScore ──────────────────────────────────────────

describe('calcThesisBreakScore', () => {
  it('thesis=null → score=0, triggered=false', () => {
    const result = calcThesisBreakScore(null, []);
    expect(result.score).toBe(0);
    expect(result.triggered).toBe(false);
  });

  it('empty invalidConditions → score=0, triggered=false', () => {
    const thesis = makeThesis({ invalidConditions: [] });
    const result = calcThesisBreakScore(thesis, []);
    expect(result.score).toBe(0);
    expect(result.triggered).toBe(false);
  });

  it('1 condition hit (_triggered=true) → score=16 (primary), triggered=true', () => {
    const thesis = makeThesis({
      invalidConditions: [{ type: 'PRICE_BELOW', value: 50000, _triggered: true }],
    });
    const result = calcThesisBreakScore(thesis, []);
    // primaryTriggered → max(8, 16) = 16
    expect(result.score).toBe(16);
    expect(result.triggered).toBe(true);
  });

  it('2 conditions hit → score=14', () => {
    const thesis = makeThesis({
      invalidConditions: [
        { type: 'STOP_LOSS_PCT', value: 8 }, // not evaluated here
        { type: 'PRICE_BELOW', value: 50000, _triggered: true },
        { type: 'VOLUME_COLLAPSE', threshold: 0.3, _triggered: true },
      ],
    });
    const result = calcThesisBreakScore(thesis, []);
    // 2 hit (PRICE_BELOW + VOLUME_COLLAPSE), first hit is PRICE_BELOW which is isFirst=false (STOP_LOSS_PCT is first)
    // so primaryTriggered=false, triggeredCount=2 → score=14
    expect(result.score).toBe(14);
    expect(result.triggered).toBe(true);
  });

  it('3 conditions hit → score=20', () => {
    const thesis = makeThesis({
      invalidConditions: [
        { type: 'PRICE_BELOW', value: 50000, _triggered: true },
        { type: 'VOLUME_COLLAPSE', threshold: 0.3, _triggered: true },
        { type: 'THESIS_METRIC_BREACH', metric: 'rsi14', threshold: 80, _triggered: true },
      ],
    });
    const result = calcThesisBreakScore(thesis, []);
    expect(result.score).toBe(20);
    expect(result.triggered).toBe(true);
  });

  it('AMENDMENT_NEGATIVE condition + matching disclosure event → hit', () => {
    const thesis = makeThesis({
      invalidConditions: [{ type: 'AMENDMENT_NEGATIVE' }],
    });
    const events: DisclosureEvent[] = [
      { type: 'AMENDMENT_NEGATIVE', rcpNo: 'RCP001' },
    ];
    const result = calcThesisBreakScore(thesis, events);
    expect(result.triggered).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('primary condition (first) hit → score = max(base, 16)', () => {
    const thesis = makeThesis({
      invalidConditions: [
        { type: 'PRICE_BELOW', value: 50000, _triggered: true }, // first → primaryTriggered
      ],
    });
    const result = calcThesisBreakScore(thesis, []);
    // triggeredCount=1 → base=8, primaryTriggered → max(8,16)=16
    expect(result.score).toBe(16);
  });
});

// ─── 4. calcChartBreakScore ───────────────────────────────────────────

describe('calcChartBreakScore', () => {
  it('all chart signals active → score capped at 20', () => {
    const tech = makeTech({
      closePrice: 60000,
      openPrice: 65000, // -7.7% drop
      ma5: 65000,       // below ma5: +6
      ma20: 63000,      // below ma20: +10
      vwap: 62000,      // below vwap: +4
      low20: 61000,     // below low20: +8
    });
    const result = calcChartBreakScore(tech);
    expect(result.score).toBe(20); // capped
    expect(result.triggered).toBe(true);
  });

  it('no triggers → score=0, triggered=false', () => {
    const tech = makeTech({
      closePrice: 70000,
      openPrice: 69000,
      ma5: 68000,  // above → no trigger
      ma20: 65000, // above → no trigger
      vwap: 66000, // above → no trigger
      low20: 64000, // above → no trigger
    });
    const result = calcChartBreakScore(tech);
    expect(result.score).toBe(0);
    expect(result.triggered).toBe(false);
  });

  it('below ma5 only → score=6', () => {
    const tech = makeTech({
      closePrice: 67000,
      openPrice: 67500, // -0.74% drop — not enough
      ma5: 68000, // below: +6
      ma20: null,
      vwap: null,
      low20: null,
    });
    const result = calcChartBreakScore(tech);
    expect(result.score).toBe(6);
    expect(result.triggered).toBe(true);
  });

  it('below ma20 only → score=10', () => {
    const tech = makeTech({
      closePrice: 62000,
      openPrice: null,
      ma5: null,
      ma20: 63000, // below: +10
      vwap: null,
      low20: null,
    });
    const result = calcChartBreakScore(tech);
    expect(result.score).toBe(10);
    expect(result.triggered).toBe(true);
  });

  it('candle drop -3% or more → +6', () => {
    const tech = makeTech({
      closePrice: 66000,
      openPrice: 70000, // -5.7% drop
      ma5: null,
      ma20: null,
      vwap: null,
      low20: null,
    });
    const result = calcChartBreakScore(tech);
    expect(result.score).toBe(6);
    expect(result.triggered).toBe(true);
  });
});

// ─── 5. calcTimeExceededScore ─────────────────────────────────────────

describe('calcTimeExceededScore', () => {
  it('maxHoldDays exceeded via thesis → score>=8', () => {
    const pos = makePosition({
      entryDate: new Date(Date.now() - 30 * 86400000), // 30 days ago
      maxHoldDays: null,
    });
    const thesis = makeThesis({ maxHoldDays: 10 }); // exceeded
    const tech = makeTech();
    const result = calcTimeExceededScore(pos, thesis, tech);
    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.triggered).toBe(true);
  });

  it('maxHoldDays exceeded via position → score>=8', () => {
    const pos = makePosition({
      entryDate: new Date(Date.now() - 30 * 86400000), // 30 days ago
      maxHoldDays: 10,
    });
    const thesis = makeThesis({ maxHoldDays: null });
    const tech = makeTech();
    const result = calcTimeExceededScore(pos, thesis, tech);
    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.triggered).toBe(true);
  });

  it('no thesis maxHoldDays, no position maxHoldDays → score=0 if recent', () => {
    const pos = makePosition({
      entryDate: new Date(), // just now
      maxHoldDays: null,
    });
    const thesis = makeThesis({ maxHoldDays: null });
    const tech = makeTech({ excessReturn5d: null, avgVolumeRatio5d: null });
    const result = calcTimeExceededScore(pos, thesis, tech);
    expect(result.score).toBe(0);
    expect(result.triggered).toBe(false);
  });

  it('score capped at 10', () => {
    const pos = makePosition({
      entryDate: new Date(Date.now() - 60 * 86400000),
      maxHoldDays: 1,
    });
    const thesis = makeThesis({ maxHoldDays: 1 });
    const tech = makeTech({
      excessReturn5d: -5, // negative → +4
      avgVolumeRatio5d: 0.3, // < 0.5 → +2
    });
    const result = calcTimeExceededScore(pos, thesis, tech);
    expect(result.score).toBeLessThanOrEqual(10);
  });
});

// ─── 6. calcOverweightScore ───────────────────────────────────────────

describe('calcOverweightScore', () => {
  it('position within limit → score=0, triggered=false', () => {
    // 10 * 70000 = 700000; pct = 7% of 10,000,000 < 10% limit
    const pos = makePosition({
      currentPrice: 70000,
      quantity: 10,
      portfolioTotalValue: 10000000,
      portfolioMaxSinglePositionPct: 10.0,
    });
    const result = calcOverweightScore(pos);
    expect(result.score).toBe(0);
    expect(result.triggered).toBe(false);
  });

  it('position overweight → score > 0, triggered=true', () => {
    // 70000 * 10 = 700000; pct = 70% of 1,000,000 → far exceeds 10% limit
    const pos = makePosition({
      currentPrice: 70000,
      quantity: 10,
      portfolioTotalValue: 1000000,
      portfolioMaxSinglePositionPct: 10.0,
    });
    const result = calcOverweightScore(pos);
    expect(result.score).toBeGreaterThan(0);
    expect(result.triggered).toBe(true);
  });

  it('portfolioTotalValue=0 → score=0', () => {
    const pos = makePosition({ portfolioTotalValue: 0 });
    const result = calcOverweightScore(pos);
    expect(result.score).toBe(0);
    expect(result.triggered).toBe(false);
  });
});

// ─── 7. calcPositiveMomentumBonus ────────────────────────────────────

describe('calcPositiveMomentumBonus', () => {
  it('strong excess return > 5% + high volume → max bonus 14', () => {
    const tech = makeTech({
      excessReturn5d: 7,
      volumeRatio3d: 2.0, // > 1.5
    });
    const bonus = calcPositiveMomentumBonus(tech);
    // 8 (excessReturn > 5) + 6 (volumeRatio > 1.5) = 14
    expect(bonus).toBe(14);
  });

  it('moderate excess return 2~5% → +4', () => {
    const tech = makeTech({
      excessReturn5d: 3,
      volumeRatio3d: null,
    });
    const bonus = calcPositiveMomentumBonus(tech);
    expect(bonus).toBe(4);
  });

  it('no momentum → bonus=0', () => {
    const tech = makeTech({
      excessReturn5d: -1,
      volumeRatio3d: 1.0,
    });
    const bonus = calcPositiveMomentumBonus(tech);
    expect(bonus).toBe(0);
  });

  it('bonus capped at 20', () => {
    const tech = makeTech({
      excessReturn5d: 100,
      volumeRatio3d: 10,
    });
    const bonus = calcPositiveMomentumBonus(tech);
    expect(bonus).toBeLessThanOrEqual(20);
  });
});

// ─── 8. calculateExitScore (integration) ─────────────────────────────

describe('calculateExitScore integration', () => {
  it('all clear (no triggers) → HOLD action, exitScore < 30', () => {
    const pos = makePosition({
      entryPrice: 70000,
      currentPrice: 72000,
      stopLossPct: null,
    });
    const tech = makeTech({
      closePrice: 72000,
      openPrice: 71000,
      ma5: 70000, // above ma5 — no trigger
      ma20: 68000, // above ma20
      excessReturn5d: 3, // positive
      volumeRatio3d: 1.8, // high volume bonus
    });
    const thesis = makeThesis();
    const result = calculateExitScore(pos, tech, thesis, []);
    expect(result.exitAction).toBe('HOLD');
    expect(result.exitScore).toBeLessThan(30);
    expect(result.triggerTypes).toHaveLength(0);
    expect(result.primaryTrigger).toBeNull();
  });

  it('stop loss hit → EXIT action, STOP_LOSS in triggerTypes', () => {
    const pos = makePosition({
      entryPrice: 70000,
      currentPrice: 63000, // -10% > -8% stop
      stopLossPct: 8,
    });
    const tech = makeTech({ closePrice: 63000, openPrice: 63500 });
    const thesis = makeThesis();
    const result = calculateExitScore(pos, tech, thesis, []);
    expect(result.triggerTypes).toContain('STOP_LOSS');
    expect(['EXIT', 'BLOCK_REBUY']).toContain(result.exitAction);
  });

  it('thesis invalidated (disclosure) → THESIS_INVALIDATED in triggerTypes', () => {
    const pos = makePosition();
    const tech = makeTech({ closePrice: 70000, openPrice: 70000 });
    const thesis = makeThesis({
      invalidConditions: [{ type: 'AMENDMENT_NEGATIVE' }],
    });
    const events: DisclosureEvent[] = [
      { type: 'AMENDMENT_NEGATIVE', rcpNo: 'RCP001' },
    ];
    const result = calculateExitScore(pos, tech, thesis, events);
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');
  });

  it('exitScore = max(0, raw) — clamp to [0, 100]', () => {
    const pos = makePosition();
    const tech = makeTech({
      excessReturn5d: 100, // massive bonus
      volumeRatio3d: 10,
    });
    const result = calculateExitScore(pos, tech, makeThesis(), []);
    expect(result.exitScore).toBeGreaterThanOrEqual(0);
    expect(result.exitScore).toBeLessThanOrEqual(100);
  });

  it('components sum matches exitScore (clamped, no hard-stop override)', () => {
    // No stopLossPct set — no hard override. Only chart signals fire.
    const pos = makePosition({
      entryPrice: 70000,
      currentPrice: 62000,
      stopLossPct: null, // no hard stop override
    });
    const tech = makeTech({
      closePrice: 62000,
      openPrice: 65000, // -4.6% drop → +6 chart
      ma5: 65000,       // below ma5 → +6
      ma20: 63000,      // below ma20 → +10
      vwap: 64000,      // below vwap → +4
      low20: null,
    });
    const result = calculateExitScore(pos, tech, makeThesis(), []);
    const { components } = result;
    const rawExpected =
      components.lossRiskScore +
      components.thesisBreakScore +
      components.chartBreakScore +
      components.disclosureRiskScore +
      components.overweightScore +
      components.timeExceededScore -
      components.positiveMomentumBonus;
    // When lossRiskScore < 20 (no hard override), exitScore = clamped rawScore
    expect(result.exitScore).toBe(Math.max(0, Math.min(100, rawExpected)));
  });
});

// ─── 9. Thesis-driven exit ────────────────────────────────────────────

describe('thesis-driven exit', () => {
  it('thesis invalidCondition _triggered=true → THESIS_INVALIDATED in triggerTypes and action >= WATCH', () => {
    const pos = makePosition({ currentPrice: 70000 });
    const tech = makeTech({ closePrice: 70000, openPrice: 70000 });
    const thesis = makeThesis({
      invalidConditions: [
        { type: 'PRICE_BELOW', value: 50000, _triggered: true },
        { type: 'VOLUME_COLLAPSE', threshold: 0.3, _triggered: true },
        { type: 'THESIS_METRIC_BREACH', metric: 'rsi14', threshold: 80, _triggered: true },
      ],
    });
    const result = calculateExitScore(pos, tech, thesis, []);
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');
    expect(['WATCH', 'REDUCE', 'EXIT', 'BLOCK_REBUY']).toContain(result.exitAction);
  });

  it('thesis with _triggered=true + stop loss → EXIT or BLOCK_REBUY', () => {
    const pos = makePosition({
      entryPrice: 70000,
      currentPrice: 63000, // -10%, stop loss
      stopLossPct: 8,
    });
    const tech = makeTech({ closePrice: 63000, openPrice: 63500 });
    const thesis = makeThesis({
      invalidConditions: [
        { type: 'PRICE_BELOW', value: 50000, _triggered: true },
      ],
    });
    const result = calculateExitScore(pos, tech, thesis, []);
    expect(result.triggerTypes).toContain('STOP_LOSS');
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');
    expect(['EXIT', 'BLOCK_REBUY']).toContain(result.exitAction);
  });
});

// ─── 10. ExitEngineService ────────────────────────────────────────────

describe('ExitEngineService', () => {
  function makeProvider(
    positions: PositionSnapshot[] = [],
    tech: TechnicalSnapshot = makeTech(),
    thesis: ThesisSnapshot | null = null,
    events: DisclosureEvent[] = [],
  ): IPositionProvider {
    return {
      getOpenPositions: async () => positions,
      getTechnicalSnapshot: async () => tech,
      getThesisSnapshot: async () => thesis,
      getDisclosureEvents: async () => events,
    };
  }

  it('checkPosition saves to repository and returns result', async () => {
    const repo = new InMemoryExitSignalRepository();
    const pos = makePosition();
    const provider = makeProvider();
    const service = new ExitEngineService(provider, repo);

    const result = await service.checkPosition(pos, 'POST_MARKET');
    expect(result).toBeDefined();
    expect(result.exitScore).toBeGreaterThanOrEqual(0);
    expect(result.exitAction).toBe('HOLD');

    const saved = await repo.findLatestByPositionId(pos.id);
    expect(saved).not.toBeNull();
    expect(saved!.exitScore).toBe(result.exitScore);
    expect(saved!.exitAction).toBe(result.exitAction);

    repo.clear();
  });

  it('checkAllPositions processes all open positions', async () => {
    const repo = new InMemoryExitSignalRepository();
    const positions = [
      makePosition({ id: 'pos-A', stockCode: '005930' }),
      makePosition({ id: 'pos-B', stockCode: '035720' }),
    ];
    const provider = makeProvider(positions);
    const service = new ExitEngineService(provider, repo);

    const results = await service.checkAllPositions('PRE_MARKET');
    expect(results).toHaveLength(2);

    const savedA = await repo.findLatestByPositionId('pos-A');
    const savedB = await repo.findLatestByPositionId('pos-B');
    expect(savedA).not.toBeNull();
    expect(savedB).not.toBeNull();

    repo.clear();
  });

  it('findLatestByPositionId returns null for unknown position', async () => {
    const repo = new InMemoryExitSignalRepository();
    const result = await repo.findLatestByPositionId('nonexistent');
    expect(result).toBeNull();
  });

  it('stop loss position → EXIT saved to repo', async () => {
    const repo = new InMemoryExitSignalRepository();
    const pos = makePosition({
      entryPrice: 70000,
      currentPrice: 63000,
      stopLossPct: 8,
    });
    const tech = makeTech({ closePrice: 63000, openPrice: 63500 });
    const provider = makeProvider([pos], tech);
    const service = new ExitEngineService(provider, repo);

    await service.checkAllPositions('POST_MARKET');
    const saved = await repo.findLatestByPositionId(pos.id);
    expect(saved).not.toBeNull();
    expect(['EXIT', 'BLOCK_REBUY']).toContain(saved!.exitAction);

    repo.clear();
  });
});

// ─── 11. DAR-74: invalidConditions 기계평가 (시세 실데이터 연결) ──────────

describe('evaluateInvalidCondition — 기계평가 (DAR-74)', () => {
  const noEvents = new Set<string>();

  it('_triggered 플래그는 타입과 무관하게 충족으로 인정한다(픽스처 호환)', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'PRICE_BELOW', value: 50000, _triggered: true },
        noEvents,
        makePosition(),
        makeTech({ closePrice: 70000 }), // 실데이터로는 미충족이지만 플래그 우선
      ),
    ).toBe(true);
  });

  it('PRICE_BELOW: 종가 < 기준가면 실데이터로 충족', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'PRICE_BELOW', value: 65000 },
        noEvents,
        makePosition(),
        makeTech({ closePrice: 60000 }),
      ),
    ).toBe(true);
  });

  it('PRICE_BELOW: 종가 >= 기준가면 미충족', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'PRICE_BELOW', value: 65000 },
        noEvents,
        makePosition(),
        makeTech({ closePrice: 70000 }),
      ),
    ).toBe(false);
  });

  it('PRICE_ABOVE: 종가 > 기준가면 충족', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'PRICE_ABOVE', value: 65000 },
        noEvents,
        makePosition(),
        makeTech({ closePrice: 70000 }),
      ),
    ).toBe(true);
  });

  it('VOLUME_COLLAPSE: 거래량비율 < 임계면 충족', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'VOLUME_COLLAPSE', threshold: 0.5 },
        noEvents,
        makePosition(),
        makeTech({ volumeRatio3d: 0.3 }),
      ),
    ).toBe(true);
  });

  it('EVENT_STUDY_UNDERPERFORM D5: 초과수익 < 임계면 충족', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'EVENT_STUDY_UNDERPERFORM', horizon: 'D5', threshold: 0 },
        noEvents,
        makePosition(),
        makeTech({ excessReturn5d: -2 }),
      ),
    ).toBe(true);
  });

  it('AMENDMENT_NEGATIVE: 매칭 공시 이벤트면 충족', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'AMENDMENT_NEGATIVE' },
        new Set(['CONTRACT_CANCELLATION']),
        makePosition(),
        makeTech(),
      ),
    ).toBe(true);
  });

  it('STOP_LOSS_PCT/MAX_HOLD_DAYS는 여기서 미평가(이중계상 방지)', () => {
    expect(
      evaluateInvalidCondition(
        { type: 'STOP_LOSS_PCT', value: 8 },
        noEvents,
        makePosition(),
        makeTech({ closePrice: 1 }),
      ),
    ).toBe(false);
    expect(
      evaluateInvalidCondition(
        { type: 'MAX_HOLD_DAYS', value: 20 },
        noEvents,
        makePosition(),
        makeTech(),
      ),
    ).toBe(false);
  });

  // 결측 폴백: 평가에 필요한 시세 필드가 null/없으면 미충족(보수) — 오탐 방지
  describe('결측 폴백 (graceful)', () => {
    it('VOLUME_COLLAPSE: 거래량비율 결측(null)이면 미충족', () => {
      expect(
        evaluateInvalidCondition(
          { type: 'VOLUME_COLLAPSE', threshold: 0.5 },
          noEvents,
          makePosition(),
          makeTech({ volumeRatio3d: null }),
        ),
      ).toBe(false);
    });

    it('EVENT_STUDY_UNDERPERFORM: 초과수익 결측(null)이면 미충족', () => {
      expect(
        evaluateInvalidCondition(
          { type: 'EVENT_STUDY_UNDERPERFORM', horizon: 'D5', threshold: 0 },
          noEvents,
          makePosition(),
          makeTech({ excessReturn5d: null }),
        ),
      ).toBe(false);
    });

    it('지원하지 않는 지평(D20)이면 미충족', () => {
      expect(
        evaluateInvalidCondition(
          { type: 'EVENT_STUDY_UNDERPERFORM', horizon: 'D20', threshold: 0 },
          noEvents,
          makePosition(),
          makeTech({ excessReturn5d: -10 }),
        ),
      ).toBe(false);
    });

    it('tech 미제공(null)이면 시세 기반 조건은 미평가(직접 단위 호출 호환)', () => {
      expect(
        evaluateInvalidCondition(
          { type: 'PRICE_BELOW', value: 65000 },
          noEvents,
          null,
          null,
        ),
      ).toBe(false);
    });
  });
});

describe('calcThesisBreakScore — 시세 기반 기계평가 연결 (DAR-74)', () => {
  it('실데이터(pos·tech)로 구조화 조건이 충족되면 _triggered 없이도 점수 발생', () => {
    const thesis = makeThesis({
      invalidConditions: [
        { type: 'PRICE_BELOW', value: 65000 }, // 종가 60000 < 65000 → 충족
        { type: 'VOLUME_COLLAPSE', threshold: 0.5 }, // 0.3 < 0.5 → 충족
      ],
    });
    const result = calcThesisBreakScore(
      thesis,
      [],
      makePosition(),
      makeTech({ closePrice: 60000, volumeRatio3d: 0.3 }),
    );
    expect(result.triggered).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('pos·tech 미제공이면 시세 조건은 평가하지 않는다(기존 단위호출 동작 보존)', () => {
    const thesis = makeThesis({
      invalidConditions: [{ type: 'PRICE_BELOW', value: 65000 }],
    });
    // 인자 2개만 → pos·tech 기본 null → 시세 조건 미평가 → 미충족
    const result = calcThesisBreakScore(thesis, []);
    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
  });

  it('calculateExitScore: 보유 시세 악화로 테제 훼손 → THESIS_INVALIDATED 트리거', () => {
    const pos = makePosition({ entryPrice: 70000, currentPrice: 60000, stopLossPct: null });
    const tech = makeTech({ closePrice: 60000, volumeRatio3d: 0.2 });
    const thesis = makeThesis({
      invalidConditions: [
        { type: 'PRICE_BELOW', value: 65000 },
        { type: 'VOLUME_COLLAPSE', threshold: 0.5 },
      ],
    });
    const result = calculateExitScore(pos, tech, thesis, []);
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');
    expect(result.components.thesisBreakScore).toBeGreaterThan(0);
  });
});

// ─── 12. DAR-94: 이벤트 타입별 가중 + 내부자 대량매도 무효화 ──────────────

function makeInsiderTrade(
  overrides: Partial<InsiderTradeSnapshot> = {},
): InsiderTradeSnapshot {
  return {
    source: 'MAJOR_STOCK',
    tradeType: 'SELL',
    ratioChange: null,
    isMajorShareholder: null,
    ...overrides,
  };
}

function makeInsiderFlow(trades: InsiderTradeSnapshot[] = []): InsiderFlowSnapshot {
  return { trades };
}

describe('HIGH_RISK_EVENT_TYPES — 고위험 5종 (DAR-71 engine1 추출기)', () => {
  it('거래정지·상폐위험·감사의견·소송·계약해지 5종을 포함한다', () => {
    expect([...HIGH_RISK_EVENT_TYPES].sort()).toEqual(
      [
        'AUDIT_OPINION_RISK',
        'CONTRACT_CANCELLATION',
        'DELISTING_RISK',
        'LAWSUIT',
        'TRADING_SUSPENSION',
      ].sort(),
    );
  });
});

describe('isLargeInsiderNetSell — 내부자/대량보유 대량 순매도 (DAR-94)', () => {
  it('null·빈 목록이면 false (결측 → 무효화 없음)', () => {
    expect(isLargeInsiderNetSell(null)).toBe(false);
    expect(isLargeInsiderNetSell(makeInsiderFlow([]))).toBe(false);
  });

  it('규모 명시 대량 매도(Δ -1.5%p)면 true', () => {
    expect(
      isLargeInsiderNetSell(
        makeInsiderFlow([makeInsiderTrade({ ratioChange: -1.5 })]),
      ),
    ).toBe(true);
  });

  it('일반 5% 보유 매도(규모 결측 1건, 0.5 < 1.0)면 false (보수)', () => {
    expect(
      isLargeInsiderNetSell(
        makeInsiderFlow([
          makeInsiderTrade({ source: 'MAJOR_STOCK', ratioChange: null }),
        ]),
      ),
    ).toBe(false);
  });

  it('임원 + 주요주주 처분(결측 0.5×1.5×1.5=1.125≥1.0)이면 true', () => {
    expect(
      isLargeInsiderNetSell(
        makeInsiderFlow([
          makeInsiderTrade({
            source: 'EXECUTIVE',
            isMajorShareholder: true,
            ratioChange: null,
          }),
        ]),
      ),
    ).toBe(true);
  });

  it('같은 윈도우 매수가 매도를 상쇄하면 false', () => {
    expect(
      isLargeInsiderNetSell(
        makeInsiderFlow([
          makeInsiderTrade({ tradeType: 'SELL', ratioChange: -1.2 }),
          makeInsiderTrade({ tradeType: 'BUY', ratioChange: 1.2 }),
        ]),
      ),
    ).toBe(false);
  });

  it('MIXED/UNKNOWN 방향은 무시(보수) → false', () => {
    expect(
      isLargeInsiderNetSell(
        makeInsiderFlow([
          makeInsiderTrade({ tradeType: 'MIXED', ratioChange: -5 }),
          makeInsiderTrade({ tradeType: 'UNKNOWN', ratioChange: -5 }),
        ]),
      ),
    ).toBe(false);
  });
});

describe('calcDisclosureRiskScore — 이벤트 타입별 가중 (DAR-94)', () => {
  it('이벤트 없음 → score 0, triggered/severe false', () => {
    const r = calcDisclosureRiskScore([]);
    expect(r.score).toBe(0);
    expect(r.triggered).toBe(false);
    expect(r.severe).toBe(false);
  });

  it('고위험 1건 → 강한 가중(16), severe true', () => {
    const r = calcDisclosureRiskScore([
      { type: 'TRADING_SUSPENSION', rcpNo: 'R1' },
    ]);
    expect(r.score).toBe(16);
    expect(r.triggered).toBe(true);
    expect(r.severe).toBe(true);
  });

  it('일반 악재 1건 → 약한 가중(5), severe false', () => {
    const r = calcDisclosureRiskScore([
      { type: 'DIVIDEND_CUT', rcpNo: 'R1' },
    ]);
    expect(r.score).toBe(5);
    expect(r.triggered).toBe(true);
    expect(r.severe).toBe(false);
  });

  it('고위험 가중 > 일반 가중 (단건 비교)', () => {
    const high = calcDisclosureRiskScore([
      { type: 'DELISTING_RISK', rcpNo: 'R1' },
    ]).score;
    const general = calcDisclosureRiskScore([
      { type: 'PAID_IN_CAPITAL_INCREASE', rcpNo: 'R2' },
    ]).score;
    expect(high).toBeGreaterThan(general);
  });

  it('다건 누적은 cap(20)에서 절단', () => {
    const r = calcDisclosureRiskScore([
      { type: 'TRADING_SUSPENSION', rcpNo: 'R1' },
      { type: 'DELISTING_RISK', rcpNo: 'R2' },
    ]);
    expect(r.score).toBe(20); // 16+16=32 → 20
    expect(r.severe).toBe(true);
  });

  it('내부자 대량 순매도만 있어도 결합(12)·severe true', () => {
    const r = calcDisclosureRiskScore(
      [],
      makeInsiderFlow([makeInsiderTrade({ ratioChange: -2 })]),
    );
    expect(r.score).toBe(12);
    expect(r.triggered).toBe(true);
    expect(r.severe).toBe(true);
  });

  it('내부자 비대량(결측 1건)은 결합하지 않는다', () => {
    const r = calcDisclosureRiskScore(
      [],
      makeInsiderFlow([makeInsiderTrade({ ratioChange: null })]),
    );
    expect(r.score).toBe(0);
    expect(r.severe).toBe(false);
  });
});

describe('calculateExitScore — 타입별 가중·무효화 통합 (DAR-94)', () => {
  it('고위험 공시는 강한 긍정 모멘텀에 가려지지 않고 최소 WATCH(severe 플로어)', () => {
    const pos = makePosition(); // 7% 비중, 손실/시간/과다비중 트리거 없음
    const tech = makeTech({
      closePrice: 70000,
      openPrice: 70000,
      excessReturn5d: 100, // 강한 모멘텀 보너스(감산 -20)
      volumeRatio3d: 10,
    });
    const result = calculateExitScore(pos, tech, makeThesis(), [
      { type: 'TRADING_SUSPENSION', rcpNo: 'R1' },
    ]);
    expect(result.components.disclosureRiskScore).toBe(16);
    expect(result.exitScore).toBeGreaterThanOrEqual(30);
    expect(['WATCH', 'REDUCE', 'EXIT', 'BLOCK_REBUY']).toContain(
      result.exitAction,
    );
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');
  });

  it('일반 악재는 강한 모멘텀에 가려질 수 있다(severe 플로어 없음)', () => {
    const pos = makePosition();
    const tech = makeTech({
      closePrice: 70000,
      openPrice: 70000,
      excessReturn5d: 100,
      volumeRatio3d: 10,
    });
    const result = calculateExitScore(pos, tech, makeThesis(), [
      { type: 'DIVIDEND_CUT', rcpNo: 'R1' },
    ]);
    // 5(disclosure) - 20(momentum) → 0, 플로어 없음 → HOLD 가능
    expect(result.exitScore).toBeLessThan(30);
    expect(result.exitAction).toBe('HOLD');
    // 트리거 자체는 표시(약하더라도 무효화 이벤트 존재)
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');
  });

  it('내부자 대량 순매도 → THESIS_INVALIDATED + 최소 WATCH', () => {
    const pos = makePosition();
    const tech = makeTech({ closePrice: 70000, openPrice: 70000 });
    const insider = makeInsiderFlow([
      makeInsiderTrade({
        source: 'EXECUTIVE',
        isMajorShareholder: true,
        ratioChange: -3,
      }),
    ]);
    const result = calculateExitScore(pos, tech, makeThesis(), [], insider);
    expect(result.components.disclosureRiskScore).toBe(12);
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');
    expect(result.exitScore).toBeGreaterThanOrEqual(30);
  });

  it('고위험 공시 점수 > 일반 악재 점수(동일 시나리오)', () => {
    const pos = makePosition();
    const tech = makeTech({ closePrice: 70000, openPrice: 70000 });
    const high = calculateExitScore(pos, tech, makeThesis(), [
      { type: 'LAWSUIT', rcpNo: 'R1' },
    ]).exitScore;
    const general = calculateExitScore(pos, tech, makeThesis(), [
      { type: 'CB_ISSUANCE', rcpNo: 'R2' },
    ]).exitScore;
    expect(high).toBeGreaterThan(general);
  });

  // ── 결정론적 스냅샷 (기존 Exit 회귀 보호) ──────────────────────────────
  it('스냅샷: 고위험 단건·무모멘텀 → 결정론적 컴포넌트/액션', () => {
    const pos = makePosition({ entryDate: new Date() }); // 시간 트리거 0
    const tech = makeTech({ closePrice: 70000, openPrice: 70000 });
    const result = calculateExitScore(pos, tech, makeThesis(), [
      { type: 'AUDIT_OPINION_RISK', rcpNo: 'R1' },
    ]);
    expect(result.components).toEqual({
      lossRiskScore: 0,
      thesisBreakScore: 0,
      chartBreakScore: 0,
      disclosureRiskScore: 16,
      overweightScore: 0,
      timeExceededScore: 0,
      positiveMomentumBonus: 0,
    });
    expect(result.exitScore).toBe(30); // raw 16 → severe 플로어 30
    expect(result.exitAction).toBe('WATCH');
    expect(result.primaryTrigger).toBe('THESIS_INVALIDATED');
  });

  it('회귀: 공시·내부자 없으면 기존 HOLD 경로 보존(무효화 트리거 없음)', () => {
    const pos = makePosition({ entryDate: new Date() });
    const tech = makeTech({ closePrice: 70000, openPrice: 70000 });
    const result = calculateExitScore(pos, tech, makeThesis(), []);
    expect(result.components.disclosureRiskScore).toBe(0);
    expect(result.exitAction).toBe('HOLD');
    expect(result.triggerTypes).not.toContain('THESIS_INVALIDATED');
  });
});

describe('ExitEngineService — getInsiderFlow 결합 (DAR-94)', () => {
  it('provider가 대량 순매도 흐름을 제공하면 무효화가 결합된다', async () => {
    const repo = new InMemoryExitSignalRepository();
    const pos = makePosition({ entryDate: new Date() });
    const provider: IPositionProvider = {
      getOpenPositions: async () => [pos],
      getTechnicalSnapshot: async () => makeTech({ closePrice: 70000, openPrice: 70000 }),
      getThesisSnapshot: async () => null,
      getDisclosureEvents: async () => [],
      getInsiderFlow: async () =>
        makeInsiderFlow([makeInsiderTrade({ ratioChange: -2 })]),
    };
    const service = new ExitEngineService(provider, repo);

    const result = await service.checkPosition(pos, 'POST_MARKET');
    expect(result.components.disclosureRiskScore).toBe(12);
    expect(result.triggerTypes).toContain('THESIS_INVALIDATED');

    const saved = await repo.findLatestByPositionId(pos.id);
    expect(saved).not.toBeNull();
    expect(saved!.exitScore).toBe(result.exitScore);
    repo.clear();
  });

  it('getInsiderFlow 미구현 provider도 정상 동작(하위호환)', async () => {
    const repo = new InMemoryExitSignalRepository();
    const pos = makePosition({ entryDate: new Date() });
    const provider: IPositionProvider = {
      getOpenPositions: async () => [pos],
      getTechnicalSnapshot: async () => makeTech({ closePrice: 70000, openPrice: 70000 }),
      getThesisSnapshot: async () => null,
      getDisclosureEvents: async () => [],
    };
    const service = new ExitEngineService(provider, repo);

    const result = await service.checkPosition(pos, 'POST_MARKET');
    expect(result.components.disclosureRiskScore).toBe(0);
    expect(result.exitAction).toBe('HOLD');
    repo.clear();
  });
});
