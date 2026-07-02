// graduation-gate-rows 단위 스펙 — DAR-68 G1~G7 리포트 행 매핑 검증
// 산식은 engine5 buildGraduationReport(정본)를 그대로 통과시키고, 이 스펙은
// "게이트 판정 → 리포트 행(상태·LOW_SAMPLE·30일 창)" 매핑의 정직 표기를 검증한다.

import { buildGraduationReport } from '../engine5-trading-risk/simulation/domain/graduation-gates';
import { GraduationMetrics } from '../engine5-trading-risk/simulation/graduation-metrics.service';
import {
  buildGraduationGateFallbackRows,
  buildGraduationGateRows,
  gateStatusOf,
  GraduationGateRowId,
  STATUS_LABEL,
} from './graduation-gate-rows';

const GATE_IDS: GraduationGateRowId[] = ['G1', 'G2', 'G3', 'G5', 'G6', 'G7'];

function makeMetrics(overrides: Partial<GraduationMetrics> = {}): GraduationMetrics {
  const base: GraduationMetrics = {
    portfolioId: 'pf-test',
    asOf: '2026-07-21T00:00:00.000Z',
    hitRate: { evaluated: 25, hits: 15, hitRatePct: 60 },
    cumulativeReturn: {
      initialCapital: 10_000_000,
      currentValue: 10_500_000,
      absolutePnl: 500_000,
      returnPct: 5,
    },
    aiCostEfficiency: {
      aiCostKrw: 50_000,
      netPnlKrw: 500_000,
      netPnlAfterAiCost: 450_000,
      aiCostToNetPnlRatio: 0.1,
    },
    exitAccuracy: { evaluated: 22, correct: 13, accuracyPct: 59.1 },
    riskAdjusted: { sharpe: 1.2, mddPct: -8.5, observations: 30, measurable: true },
    benchmarkAlpha: {
      indexCode: '0001',
      portfolioReturnPct: 5,
      benchmarkReturnPct: 2,
      alphaPct: 3,
      fromDate: '20260621',
      toDate: '20260721',
      measurable: true,
    },
    simulationProgress: {
      windowDays: 30,
      startDate: '2026-06-21T00:00:00.000Z',
      asOf: '2026-07-21T00:00:00.000Z',
      elapsedDays: 30,
      remainingDays: 0,
      progressRatio: 1,
      awaitingMeasurement: false,
      windowComplete: true,
    },
    config: { hitRateHorizonDays: 5, exitAccuracyHorizonDays: 3, usdKrwRate: 1350 },
  };
  return { ...base, ...overrides };
}

function buildRows(metrics: GraduationMetrics) {
  return buildGraduationGateRows(metrics, buildGraduationReport(metrics));
}

describe('gateStatusOf — 상태 매핑', () => {
  it('30일 창 완주: pass=true→PASS, false→FAIL, null→HOLD', () => {
    expect(gateStatusOf(true, true)).toBe('PASS');
    expect(gateStatusOf(false, true)).toBe('FAIL');
    expect(gateStatusOf(null, true)).toBe('HOLD');
  });

  it('30일 창 미완주: pass 값과 무관하게 HOLD (§9 "30일 운용 후 평가")', () => {
    expect(gateStatusOf(true, false)).toBe('HOLD');
    expect(gateStatusOf(false, false)).toBe('HOLD');
    expect(gateStatusOf(null, false)).toBe('HOLD');
  });

  it('STATUS_LABEL 에 FAIL(미달) 라벨이 존재한다', () => {
    expect(STATUS_LABEL.FAIL).toBe('❌ 미달');
    expect(STATUS_LABEL.PASS).toBe('✅ 통과');
    expect(STATUS_LABEL.HOLD).toBe('⏸ 보류');
  });
});

describe('buildGraduationGateRows — 30일 창 완주·전 게이트 측정 가능', () => {
  const rows = buildRows(makeMetrics());

  it('G1~G7(G4 제외) 행을 §9 ID 로 생성한다', () => {
    GATE_IDS.forEach((id) => expect(rows[id].id).toBe(id));
  });

  it('전 게이트 기준 충족 → PASS (G1 60%≥55, G2 5%>0, G3 10%≤20, G5 59.1%≥50, G6 -8.5%≥-15, G7 +3>0)', () => {
    GATE_IDS.forEach((id) => expect(rows[id].status).toBe('PASS'));
  });

  it('G6 은 MDD 측정값·평가액 점수를 표기한다 (DAR-68 산식 재사용)', () => {
    expect(rows.G6.name).toContain('최대낙폭(MDD)');
    expect(rows.G6.target).toBe('≥-15%');
    expect(rows.G6.measured).toContain('MDD -8.50%');
    expect(rows.G6.measured).toContain('30점');
    expect(rows.G6.evidence).toContain('calcMaxDrawdownPct');
  });

  it('G7 은 alpha·포트/KOSPI 수익률·기간을 표기한다', () => {
    expect(rows.G7.name).toContain('KOSPI 대비 초과수익');
    expect(rows.G7.target).toBe('>0%');
    expect(rows.G7.measured).toContain('+3.00%p');
    expect(rows.G7.measured).toContain('KOSPI 2.00%');
    expect(rows.G7.measured).toContain('20260621~20260721');
    expect(rows.G7.evidence).toContain('calcBenchmarkAlpha');
  });

  it('G1/G5 표본수를 측정 문자열에 표기한다 (F12 표본하한 근거)', () => {
    expect(rows.G1.measured).toContain('25건');
    expect(rows.G5.measured).toContain('22건');
  });
});

describe('buildGraduationGateRows — 기준 미달(FAIL 정직 표기)', () => {
  it('G6: MDD -20% < -15% 한도 → FAIL', () => {
    const rows = buildRows(
      makeMetrics({
        riskAdjusted: { sharpe: 0.4, mddPct: -20, observations: 30, measurable: true },
      }),
    );
    expect(rows.G6.status).toBe('FAIL');
    expect(rows.G6.measured).toContain('MDD -20.00%');
  });

  it('G6: MDD 가 한도(-15%)와 같으면 gte 비교로 PASS (graduation-gates 산식 위임)', () => {
    const rows = buildRows(
      makeMetrics({
        riskAdjusted: { sharpe: 0.4, mddPct: -15, observations: 30, measurable: true },
      }),
    );
    expect(rows.G6.status).toBe('PASS');
  });

  it('G7: alpha ≤ 0 → FAIL (KOSPI 열위 위장통과 방지)', () => {
    const rows = buildRows(
      makeMetrics({
        benchmarkAlpha: {
          indexCode: '0001',
          portfolioReturnPct: 1,
          benchmarkReturnPct: 4,
          alphaPct: -3,
          fromDate: '20260621',
          toDate: '20260721',
          measurable: true,
        },
      }),
    );
    expect(rows.G7.status).toBe('FAIL');
    expect(rows.G7.measured).toContain('-3.00%p');
  });
});

describe('buildGraduationGateRows — LOW_SAMPLE·측정 불가(HOLD 정직 표기)', () => {
  it('G1: 표본 5건 < 20건(F12) → HOLD + LOW_SAMPLE 표기', () => {
    const rows = buildRows(
      makeMetrics({ hitRate: { evaluated: 5, hits: 3, hitRatePct: 60 } }),
    );
    expect(rows.G1.status).toBe('HOLD');
    expect(rows.G1.measured).toContain('LOW_SAMPLE');
    expect(rows.G1.measured).toContain('5건 < 20건');
  });

  it('G5: 표본 부족 → HOLD + LOW_SAMPLE 표기', () => {
    const rows = buildRows(
      makeMetrics({ exitAccuracy: { evaluated: 3, correct: 2, accuracyPct: 66.7 } }),
    );
    expect(rows.G5.status).toBe('HOLD');
    expect(rows.G5.measured).toContain('LOW_SAMPLE');
  });

  it('G3: 순익 ≤ 0 → HOLD + 측정 불가 표기', () => {
    const rows = buildRows(
      makeMetrics({
        aiCostEfficiency: {
          aiCostKrw: 50_000,
          netPnlKrw: -100_000,
          netPnlAfterAiCost: -150_000,
          aiCostToNetPnlRatio: -1,
        },
      }),
    );
    expect(rows.G3.status).toBe('HOLD');
    expect(rows.G3.measured).toContain('측정 불가');
  });

  it('G6: 평가액 스냅샷 2점 < 3점 → HOLD + LOW_SAMPLE 표기', () => {
    const rows = buildRows(
      makeMetrics({
        riskAdjusted: { sharpe: null, mddPct: null, observations: 2, measurable: false },
      }),
    );
    expect(rows.G6.status).toBe('HOLD');
    expect(rows.G6.measured).toContain('LOW_SAMPLE');
    expect(rows.G6.measured).toContain('2점 < 3점');
  });

  it('G7: 지수 정합 부족 → HOLD + LOW_SAMPLE 표기', () => {
    const rows = buildRows(
      makeMetrics({
        benchmarkAlpha: {
          indexCode: '0001',
          portfolioReturnPct: 5,
          benchmarkReturnPct: null,
          alphaPct: null,
          fromDate: null,
          toDate: null,
          measurable: false,
        },
      }),
    );
    expect(rows.G7.status).toBe('HOLD');
    expect(rows.G7.measured).toContain('LOW_SAMPLE');
    expect(rows.G7.measured).toContain('KOSPI(0001)');
  });
});

describe('buildGraduationGateRows — 30일 창 미완주(전 게이트 HOLD)', () => {
  const rows = buildRows(
    makeMetrics({
      simulationProgress: {
        windowDays: 30,
        startDate: '2026-07-11T00:00:00.000Z',
        asOf: '2026-07-21T00:00:00.000Z',
        elapsedDays: 10,
        remainingDays: 20,
        progressRatio: 10 / 30,
        awaitingMeasurement: false,
        windowComplete: false,
      },
    }),
  );

  it('측정값이 기준을 충족해도 창 완주 전에는 HOLD', () => {
    GATE_IDS.forEach((id) => expect(rows[id].status).toBe('HOLD'));
  });

  it('측정 문자열에 경과일(참고 표기)을 포함한다', () => {
    expect(rows.G2.measured).toContain('경과 10/30일');
    expect(rows.G6.measured).toContain('경과 10/30일');
  });

  it('운용 시작 전(awaitingMeasurement)은 측정 대기로 표기한다', () => {
    const waiting = buildRows(
      makeMetrics({
        cumulativeReturn: {
          initialCapital: 10_000_000,
          currentValue: 10_000_000,
          absolutePnl: 0,
          returnPct: 0,
        },
        simulationProgress: {
          windowDays: 30,
          startDate: null,
          asOf: '2026-07-21T00:00:00.000Z',
          elapsedDays: null,
          remainingDays: null,
          progressRatio: 0,
          awaitingMeasurement: true,
          windowComplete: false,
        },
      }),
    );
    expect(waiting.G2.status).toBe('HOLD');
    expect(waiting.G2.measured).toContain('측정 대기');
  });
});

describe('buildGraduationGateFallbackRows — 모의 포트폴리오 부재/조회 실패', () => {
  const rows = buildGraduationGateFallbackRows();

  it('G1~G7(G4 제외) 전부 HOLD 로 정직 표기한다', () => {
    GATE_IDS.forEach((id) => {
      expect(rows[id].id).toBe(id);
      expect(rows[id].status).toBe('HOLD');
      expect(rows[id].measured).toContain('측정 불가');
    });
  });

  it('G6/G7 은 DAR-68 근거를 유지한다', () => {
    expect(rows.G6.name).toContain('최대낙폭(MDD)');
    expect(rows.G6.evidence).toContain('DAR-68');
    expect(rows.G7.name).toContain('KOSPI 대비 초과수익');
    expect(rows.G7.evidence).toContain('DAR-68');
  });
});
