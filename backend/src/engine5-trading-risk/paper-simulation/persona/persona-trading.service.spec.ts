/**
 * persona-trading.service.spec.ts — persona 종합/추천 배선 검증 (DAR-130)
 *
 * styleSim(성과)·regimeService(레짐)를 모킹해, getOverview 가 복합점수 순 정렬·추천·dataLimited 를
 * 정확히 결합하는지 결정론적으로 검증한다(DB·AI 0).
 */

import { PersonaTradingService } from './persona-trading.service';
import {
  PhilosophyStyleSimulationService,
  StyleComparison,
  StylePerformance,
} from '../philosophy-style-simulation.service';
import { MarketRegimeService } from './market-regime.service';
import { MarketRegime } from './market-regime';
import { PhilosophyStyle, STYLE_LABELS } from '../philosophy-style';

function perf(
  style: PhilosophyStyle,
  cumulativeReturnPct: number,
  sampleSize: number,
  mddPct: number | null,
  hitRatePct: number,
): StylePerformance {
  return {
    style,
    label: STYLE_LABELS[style],
    portfolioId: `pf-${style}`,
    initialCapital: 10_000_000,
    equityCurve: [],
    latestSnapshotDate: null,
    scorecard: {
      closedCount: sampleSize,
      winCount: 0,
      lossCount: 0,
      winRate: null,
      avgPnl: 0,
      avgPnlPct: 0,
      avgHoldDays: null,
      totalNetPnl: 0,
      cumulativeReturnPct,
      sampleSize,
      lowSample: sampleSize < 5,
    },
    graduation: {
      hitRatePct,
      hitRateSampleSize: sampleSize,
      sharpe: null,
      mddPct,
      benchmarkAlphaPct: null,
    },
    openPositions: 0,
    lowSample: sampleSize < 5,
  };
}

function comparison(styles: StylePerformance[]): StyleComparison {
  return {
    initialCapital: 10_000_000,
    styles,
    ranking: { ranking: styles.map((s) => s.style), bestStyle: null, allLowSample: true },
    lowSampleThreshold: 5,
    minEntryFit: 50,
  };
}

const regime: MarketRegime = {
  trend: 'UPTREND',
  volatility: 'HIGH',
  eventSkew: 'OPPORTUNITY',
  trendChangePct: 8,
  dailyVolatilityPct: 2,
  indexSampleSize: 40,
  eventSampleSize: 50,
  eventPolarity: { positive: 40, negative: 10, mixed: 0, unknown: 0 },
  classifiable: true,
  dataLimited: false,
  asOf: '20260608',
};

function makeService(
  cmp: StyleComparison,
  rgm: MarketRegime,
): PersonaTradingService {
  const styleSim = {
    getStyleComparison: jest.fn().mockResolvedValue(cmp),
    runDailyCycleAllStyles: jest.fn(),
  } as unknown as PhilosophyStyleSimulationService;
  const regimeService = {
    getCurrentRegime: jest.fn().mockResolvedValue(rgm),
  } as unknown as MarketRegimeService;
  return new PersonaTradingService(styleSim, regimeService);
}

describe('PersonaTradingService (DAR-130)', () => {
  it('getOverview — persona별 성과 + 레짐 + 추천 결합, 복합점수 순 정렬', async () => {
    const cmp = comparison([
      perf('BUFFETT', 0, 0, null, 0),
      perf('LYNCH', 0, 0, null, 0),
      perf('GREENBLATT', 0, 0, null, 0),
      perf('DRUCKENMILLER', 0, 0, null, 0),
    ]);
    const svc = makeService(cmp, regime);
    const out = await svc.getOverview();

    expect(out.personas).toHaveLength(4);
    // 복합점수 내림차순
    for (let i = 1; i < out.personas.length; i++) {
      expect(out.personas[i - 1].compositeScore).toBeGreaterThanOrEqual(
        out.personas[i].compositeScore,
      );
    }
    // 강한 상승·고변동·호재장 → MACRO(드러켄밀러) 1순위 추천
    expect(out.personas[0].performance.style).toBe('DRUCKENMILLER');
    expect(out.recommended).toContain('DRUCKENMILLER');
    expect(out.recommended.length).toBeGreaterThanOrEqual(1);
    expect(out.recommended.length).toBeLessThanOrEqual(2);
    // 표본 0 → dataLimited
    expect(out.dataLimited).toBe(true);
    expect(out.significantSampleThreshold).toBe(30);
    // 아키타입·근거 노출
    expect(out.personas[0].archetype).toBe('MACRO');
    expect(out.personas[0].rationale.length).toBeGreaterThan(0);
  });

  it('getOverview — 각 persona 행이 기반 성과(performance)를 그대로 보존', async () => {
    const cmp = comparison([
      perf('BUFFETT', 12, 35, -8, 60),
      perf('LYNCH', -3, 32, -15, 40),
      perf('GREENBLATT', 5, 31, -10, 55),
      perf('DRUCKENMILLER', 20, 33, -25, 65),
    ]);
    const svc = makeService(cmp, regime);
    const out = await svc.getOverview();
    const buffett = out.personas.find((p) => p.performance.style === 'BUFFETT')!;
    expect(buffett.performance.scorecard.cumulativeReturnPct).toBe(12);
    expect(buffett.performance.graduation.mddPct).toBe(-8);
    // 표본 ≥ 30 → dataLimited 는 레짐(false) + 성과 신뢰 → false
    expect(out.dataLimited).toBe(false);
  });

  it('getRegime — 레짐 위임', async () => {
    const svc = makeService(comparison([]), regime);
    expect(await svc.getRegime()).toEqual(regime);
  });

  it('결정론: 동일 입력 → 동일 출력', async () => {
    const cmp = comparison([
      perf('BUFFETT', 4, 35, -10, 55),
      perf('DRUCKENMILLER', 9, 33, -20, 60),
    ]);
    const a = await makeService(cmp, regime).getOverview();
    const b = await makeService(cmp, regime).getOverview();
    expect(a).toEqual(b);
  });
});
