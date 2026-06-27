/**
 * signal-feature-ab.spec.ts — 피처 A/B 백테스트 순수함수 검증 (DAR-101)
 *
 * 검증: 동일 신호셋 재채점(피처 포함 vs 미포함)·피처별 delta·LOW_SAMPLE HOLD·빈데이터 graceful·
 *   BLOCKED 보존·가중치 불변(read-only). 결정론적(외부 I/O 0).
 */

import {
  buildFeatureAbReport,
  FeatureAbInput,
  FEATURE_BUCKETS,
  rescoreSignal,
  ScoreBreakdownLike,
} from './signal-feature-ab';
import { BUY_SCORE_WEIGHTS } from '../buy-signal/config/buy-signal.config';

/** 모든 레거시 7버킷을 동일 점수로 채운 breakdown 생성(피처는 별도 지정) */
function bd(
  legacy: number,
  feat: { insider?: number; fundamental?: number } = {},
): ScoreBreakdownLike {
  return {
    disclosureEvent: legacy,
    keyMetric: legacy,
    personaFit: legacy,
    historicalEvent: legacy,
    chart: legacy,
    volumeLiquidity: legacy,
    marketSector: legacy,
    insider: feat.insider ?? 0,
    fundamental: feat.fundamental ?? 0,
  };
}

function input(
  partial: Partial<FeatureAbInput> & { breakdown: ScoreBreakdownLike },
): FeatureAbInput {
  return {
    riskPenalty: 0,
    originalGrade: 'WATCH',
    eventType: 'SUPPLY_CONTRACT',
    arD5: null,
    arD20: null,
    ...partial,
  };
}

describe('rescoreSignal', () => {
  it('BLOCKED 원등급은 가중치 무관하게 보존된다', () => {
    const r = rescoreSignal(
      input({ breakdown: bd(100, { fundamental: 100 }), originalGrade: 'BLOCKED' }),
      new Set(FEATURE_BUCKETS),
    );
    expect(r.grade).toBe('BLOCKED');
    expect(r.buyScore).toBe(-100);
  });

  it('레거시 동일 점수만 있으면 재채점 점수=그 점수(가중치 합=1 보존)', () => {
    const r = rescoreSignal(input({ breakdown: bd(43) }), new Set());
    expect(r.buyScore).toBe(43);
    expect(r.grade).toBe('WATCH');
  });

  it('피처 점수가 0이면 가용 제외 → 미포함과 동일(불필요한 희석 없음)', () => {
    const withFeat = rescoreSignal(
      input({ breakdown: bd(43, { fundamental: 0, insider: 0 }) }),
      new Set(FEATURE_BUCKETS),
    );
    const without = rescoreSignal(input({ breakdown: bd(43) }), new Set());
    expect(withFeat.buyScore).toBe(without.buyScore);
  });

  it('강한 펀더멘털 피처는 WATCH 경계 신호를 BUY 로 끌어올린다', () => {
    const without = rescoreSignal(input({ breakdown: bd(43) }), new Set());
    const withFeat = rescoreSignal(
      input({ breakdown: bd(43, { fundamental: 100 }) }),
      new Set(['fundamental']),
    );
    expect(without.grade).toBe('WATCH');
    expect(withFeat.grade).toBe('BUY_CANDIDATE');
    expect(withFeat.buyScore).toBeGreaterThan(without.buyScore);
  });
});

describe('buildFeatureAbReport — A/B 재채점·delta', () => {
  // Z: 항상 매수등급(STRONG_BUY) 기준선, 피처 무관(둘 다 0). 2승 1패.
  const baselineBullish: FeatureAbInput[] = [
    input({ breakdown: bd(90), originalGrade: 'STRONG_BUY_CANDIDATE', arD5: 5, arD20: 5 }),
    input({ breakdown: bd(90), originalGrade: 'STRONG_BUY_CANDIDATE', arD5: 5, arD20: 5 }),
    input({ breakdown: bd(90), originalGrade: 'STRONG_BUY_CANDIDATE', arD5: -5, arD20: -5 }),
  ];

  it('피처가 경계 신호를 매수로 승격하고 그것이 승자면 적중률 IMPROVES', () => {
    // X: 경계(WATCH) → 펀더멘털로 BUY 승격, 6건 모두 승자
    const flippedWinners: FeatureAbInput[] = Array.from({ length: 6 }, () =>
      input({ breakdown: bd(43, { fundamental: 100 }), arD5: 8, arD20: 8 }),
    );
    const report = buildFeatureAbReport([...baselineBullish, ...flippedWinners]);

    expect(report.withFeatures.bullishCount).toBeGreaterThan(
      report.withoutFeatures.bullishCount,
    );
    expect(report.overall.bullishCountDelta).toBe(6);
    expect(report.overall.changedCount).toBe(6);
    expect(report.overall.changedRealizedD20).toBe(6);
    expect(report.overall.lowSample).toBe(false);
    expect(report.overall.d20WinRateDelta).not.toBeNull();
    expect(report.overall.d20WinRateDelta as number).toBeGreaterThan(0);
    expect(report.overall.verdict).toBe('IMPROVES');
  });

  it('피처가 패자를 매수로 승격하면 적중률 DEGRADES', () => {
    const flippedLosers: FeatureAbInput[] = Array.from({ length: 6 }, () =>
      input({ breakdown: bd(43, { fundamental: 100 }), arD5: -8, arD20: -8 }),
    );
    const report = buildFeatureAbReport([...baselineBullish, ...flippedLosers]);
    expect(report.overall.d20WinRateDelta as number).toBeLessThan(0);
    expect(report.overall.verdict).toBe('DEGRADES');
  });

  it('피처별 delta 가 기여 피처를 정확히 귀속한다(fundamental 효과, insider 무효)', () => {
    const flippedWinners: FeatureAbInput[] = Array.from({ length: 6 }, () =>
      input({ breakdown: bd(43, { fundamental: 100 }), arD5: 8, arD20: 8 }),
    );
    const report = buildFeatureAbReport([...baselineBullish, ...flippedWinners]);

    const fund = report.perFeature.find((f) => f.feature === 'fundamental')!;
    const ins = report.perFeature.find((f) => f.feature === 'insider')!;

    expect(fund.featureActiveCount).toBe(6);
    expect(fund.delta.verdict).toBe('IMPROVES');
    expect(fund.delta.changedCount).toBe(6);

    // insider 점수 전무 → 변동 0 → 관측표본 부족 → HOLD
    expect(ins.featureActiveCount).toBe(0);
    expect(ins.delta.changedCount).toBe(0);
    expect(ins.delta.verdict).toBe('HOLD');
  });

  it('등급 변동 실현표본 < LOW_SAMPLE_THRESHOLD → verdict HOLD(과적합 경계)', () => {
    // 단 2건만 승격(실현표본 2 < 5)
    const fewFlips: FeatureAbInput[] = Array.from({ length: 2 }, () =>
      input({ breakdown: bd(43, { fundamental: 100 }), arD5: 8, arD20: 8 }),
    );
    const report = buildFeatureAbReport([...baselineBullish, ...fewFlips]);
    expect(report.overall.changedRealizedD20).toBe(2);
    expect(report.overall.lowSample).toBe(true);
    expect(report.overall.verdict).toBe('HOLD');
  });

  it('피처 점수가 전무하면 두 구성이 동일 → 변동 0', () => {
    const noFeatures: FeatureAbInput[] = [
      input({ breakdown: bd(70), originalGrade: 'BUY_CANDIDATE', arD20: 3 }),
      input({ breakdown: bd(40), arD20: -2 }),
    ];
    const report = buildFeatureAbReport(noFeatures);
    expect(report.overall.changedCount).toBe(0);
    expect(report.overall.bullishCountDelta).toBe(0);
    expect(report.withFeatures.bullishCount).toBe(report.withoutFeatures.bullishCount);
    expect(report.overall.verdict).toBe('HOLD'); // 관측 효과 0 → HOLD
  });

  it('빈 데이터셋 graceful — hasData=false, 예외 없음', () => {
    const report = buildFeatureAbReport([]);
    expect(report.hasData).toBe(false);
    expect(report.totalSignals).toBe(0);
    expect(report.realizedD5).toBe(0);
    expect(report.withoutFeatures.bullishCount).toBe(0);
    expect(report.withFeatures.bullishCount).toBe(0);
    expect(report.overall.verdict).toBe('HOLD');
    expect(report.perFeature).toHaveLength(2);
  });

  it('실현수익이 없으면(arD5/arD20 모두 null) hasData=false', () => {
    const report = buildFeatureAbReport([
      input({ breakdown: bd(90, { fundamental: 50 }), originalGrade: 'STRONG_BUY_CANDIDATE' }),
    ]);
    expect(report.hasData).toBe(false);
    expect(report.realizedD5).toBe(0);
    expect(report.realizedD20).toBe(0);
  });

  it('★ read-only — 리포트 산출이 BUY_SCORE_WEIGHTS 를 변경하지 않는다', () => {
    const snapshot = JSON.stringify(BUY_SCORE_WEIGHTS);
    buildFeatureAbReport([
      input({ breakdown: bd(43, { fundamental: 100, insider: 80 }), arD5: 8, arD20: 8 }),
    ]);
    expect(JSON.stringify(BUY_SCORE_WEIGHTS)).toBe(snapshot);
  });
});
