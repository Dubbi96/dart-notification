/**
 * signal-accuracy.grade-precision.spec.ts — 등급 정밀도 매트릭스 단위 테스트 (DAR-80)
 *
 * 검증축: confusion matrix(예측등급×실현 양/음수익 TP/FP/TN/FN·precision/recall/accuracy)·
 *   등급 단조성(상위등급일수록 평균AR·승률 단조 증가·위반 카운트·Spearman 순위상관)·
 *   빈데이터 graceful(hasData=false)·LOW_SAMPLE 표기·report 통합.
 */
import {
  computeConfusionMatrix,
  computeGradeMonotonicity,
  buildGradePrecisionMatrix,
  spearmanRankCorrelation,
  gradeRank,
  buildSignalAccuracyReport,
  GRADE_RANK_ORDER,
  LOW_SAMPLE_THRESHOLD,
  SignalRealizedReturn,
} from './signal-accuracy';

function sig(partial: Partial<SignalRealizedReturn>): SignalRealizedReturn {
  return {
    signalGrade: 'BUY_CANDIDATE',
    buyScore: 65,
    eventType: 'SUPPLY_CONTRACT',
    arD5: 1,
    arD20: 2,
    ...partial,
  };
}

describe('gradeRank (등급 서열)', () => {
  it('SignalGrade 서열대로 인덱스', () => {
    expect(gradeRank('STRONG_BUY_CANDIDATE')).toBe(0);
    expect(gradeRank('BUY_CANDIDATE')).toBe(1);
    expect(gradeRank('WATCH')).toBe(2);
    expect(gradeRank('BLOCKED')).toBe(5);
  });
  it('미등재 등급은 서열 끝', () => {
    expect(gradeRank('UNKNOWN_GRADE')).toBe(GRADE_RANK_ORDER.length);
  });
});

describe('spearmanRankCorrelation', () => {
  it('완전 동일 순위 → +1', () => {
    expect(spearmanRankCorrelation([1, 2, 3], [10, 20, 30])).toBe(1);
  });
  it('완전 역순 → -1', () => {
    expect(spearmanRankCorrelation([1, 2, 3], [30, 20, 10])).toBe(-1);
  });
  it('표본<2 → null', () => {
    expect(spearmanRankCorrelation([1], [2])).toBeNull();
  });
  it('한 변수 전부 동점(분산0) → null', () => {
    expect(spearmanRankCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
  });
  it('길이 불일치 → null', () => {
    expect(spearmanRankCorrelation([1, 2], [1, 2, 3])).toBeNull();
  });
});

describe('computeConfusionMatrix (예측등급 × 실현 양/음수익)', () => {
  it('TP/FP/TN/FN 과 precision·recall·accuracy 정확 산출', () => {
    const returns: SignalRealizedReturn[] = [
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 3 }), // 매수 & 양 → TP
      sig({ signalGrade: 'BUY_CANDIDATE', arD5: -2 }), // 매수 & 음 → FP
      sig({ signalGrade: 'WATCH', arD5: 5 }), // 비매수 & 양 → FN
      sig({ signalGrade: 'AVOID', arD5: -1 }), // 비매수 & 음 → TN
    ];
    const cm = computeConfusionMatrix(returns, 'd5');
    expect(cm.horizon).toBe('d5');
    expect(cm.sampleCount).toBe(4);
    expect(cm.truePositive).toBe(1);
    expect(cm.falsePositive).toBe(1);
    expect(cm.falseNegative).toBe(1);
    expect(cm.trueNegative).toBe(1);
    expect(cm.precision).toBe(0.5); // 1/(1+1)
    expect(cm.recall).toBe(0.5); // 1/(1+1)
    expect(cm.accuracy).toBe(0.5); // (1+1)/4
    expect(cm.lowSample).toBe(true); // 4 < 5
  });

  it('해당 지평 미실현(null)은 표본에서 제외', () => {
    const returns: SignalRealizedReturn[] = [
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD20: 3 }),
      sig({ signalGrade: 'BUY_CANDIDATE', arD20: null }), // d20 제외
      sig({ signalGrade: 'WATCH', arD20: -4 }),
    ];
    const cm = computeConfusionMatrix(returns, 'd20');
    expect(cm.sampleCount).toBe(2);
    expect(cm.truePositive).toBe(1); // STRONG & 양
    expect(cm.trueNegative).toBe(1); // WATCH & 음
    expect(cm.falsePositive).toBe(0);
    expect(cm.falseNegative).toBe(0);
  });

  it('0 표본이면 precision/recall/accuracy 모두 null (graceful)', () => {
    const cm = computeConfusionMatrix([], 'd5');
    expect(cm.sampleCount).toBe(0);
    expect(cm.precision).toBeNull();
    expect(cm.recall).toBeNull();
    expect(cm.accuracy).toBeNull();
    expect(cm.lowSample).toBe(true);
  });

  it('AR=0(제자리)은 양수익 아님 → 비적중 처리', () => {
    const cm = computeConfusionMatrix(
      [sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 0 })],
      'd5',
    );
    expect(cm.truePositive).toBe(0);
    expect(cm.falsePositive).toBe(1); // 매수등급인데 0(비양수익)
  });

  it('LOW_SAMPLE 경계: 실현표본≥임계면 lowSample=false', () => {
    const returns = Array.from({ length: LOW_SAMPLE_THRESHOLD }, () =>
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 2 }),
    );
    const cm = computeConfusionMatrix(returns, 'd5');
    expect(cm.sampleCount).toBe(LOW_SAMPLE_THRESHOLD);
    expect(cm.lowSample).toBe(false);
  });
});

describe('computeGradeMonotonicity (등급 단조성)', () => {
  it('상위등급일수록 평균AR 단조 증가 → 위반 0, isMonotonic, 상관 +1', () => {
    const returns: SignalRealizedReturn[] = [
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 4 }),
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 6 }), // avg 5
      sig({ signalGrade: 'BUY_CANDIDATE', arD5: 2 }),
      sig({ signalGrade: 'BUY_CANDIDATE', arD5: 4 }), // avg 3
      sig({ signalGrade: 'WATCH', arD5: -1 }),
      sig({ signalGrade: 'WATCH', arD5: 1 }), // avg 0
    ];
    const m = computeGradeMonotonicity(returns, 'd5');
    expect(m.orderedGrades.map((g) => g.grade)).toEqual([
      'STRONG_BUY_CANDIDATE',
      'BUY_CANDIDATE',
      'WATCH',
    ]);
    expect(m.orderedGrades.map((g) => g.avgExcessReturn)).toEqual([5, 3, 0]);
    expect(m.comparedPairs).toBe(2);
    expect(m.avgReturnViolations).toBe(0);
    expect(m.isMonotonic).toBe(true);
    expect(m.avgReturnRankCorrelation).toBe(1); // 우수등급=고수익 완전단조
  });

  // DAR-410 — 등급 역전이 이상치 오염 아티팩트임을 증명: 산술평균은 거짓 역전(isMonotonic=false)
  //   이지만 강건(median) 축은 단조 성립(isRobustMonotonic=true). 실측(BLOCKED +7.69 mean,
  //   med/win 은 최저) 패턴 재현.
  it('이상치 오염 시 평균AR 단조는 거짓 위반·강건AR 단조는 성립(isRobustMonotonic)', () => {
    const watch = Array.from({ length: 8 }, (_, i) => ({ v: [-3, -5, -4, -6, -2, -7, -4, 3][i] }));
    const blocked = Array.from({ length: 8 }, (_, i) => ({ v: [-6, -7, -8, -6, -7, -5, -6, 200][i] })); // 7손실 + 1폭등(오염)
    const returns: SignalRealizedReturn[] = [
      ...watch.map((x) => sig({ signalGrade: 'WATCH', arD20: x.v })),
      ...blocked.map((x) => sig({ signalGrade: 'BLOCKED', arD20: x.v })),
    ];
    const m = computeGradeMonotonicity(returns, 'd20');
    const [w, b] = m.orderedGrades; // WATCH(rank2) → BLOCKED(rank5)
    expect(w.grade).toBe('WATCH');
    expect(b.grade).toBe('BLOCKED');
    // 산술평균: BLOCKED 가 폭등 1개로 더 높아 거짓 역전 → 평균AR 위반
    expect(b.avgExcessReturn as number).toBeGreaterThan(w.avgExcessReturn as number);
    expect(m.avgReturnViolations).toBe(1);
    expect(m.isMonotonic).toBe(false); // 평균 기준 = 거짓 역전(오염)
    // 강건AR: BLOCKED 의 median 은 음수로 WATCH 보다 낮음 → 위반 0, 단조 성립
    expect(b.robustExcessReturn as number).toBeLessThan(w.robustExcessReturn as number);
    expect(m.robustReturnViolations).toBe(0);
    expect(m.isRobustMonotonic).toBe(true); // ★권위 판정: 등급 단조 성립
  });

  it('열위 등급이 우수 등급보다 평균AR 높으면 위반 카운트', () => {
    const returns: SignalRealizedReturn[] = [
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 1 }),
      sig({ signalGrade: 'BUY_CANDIDATE', arD5: 5 }), // 열위가 더 높음 → 위반
    ];
    const m = computeGradeMonotonicity(returns, 'd5');
    expect(m.comparedPairs).toBe(1);
    expect(m.avgReturnViolations).toBe(1);
    expect(m.isMonotonic).toBe(false);
  });

  it('승률 단조 위반도 별도 카운트', () => {
    const returns: SignalRealizedReturn[] = [
      // STRONG: 1승 1패 → winRate 0.5
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 2 }),
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: -2 }),
      // BUY: 2승 0패 → winRate 1 (열위가 더 높음 → 위반)
      sig({ signalGrade: 'BUY_CANDIDATE', arD5: 3 }),
      sig({ signalGrade: 'BUY_CANDIDATE', arD5: 4 }),
    ];
    const m = computeGradeMonotonicity(returns, 'd5');
    expect(m.winRateViolations).toBe(1);
  });

  it('빈 입력 → 빈 등급·비교쌍0·상관 null·비단조', () => {
    const m = computeGradeMonotonicity([], 'd20');
    expect(m.orderedGrades).toEqual([]);
    expect(m.comparedPairs).toBe(0);
    expect(m.avgReturnViolations).toBe(0);
    expect(m.avgReturnRankCorrelation).toBeNull();
    expect(m.isMonotonic).toBe(false);
  });

  it('단일 등급만 있으면 비교쌍 0 → 비단조(변별력 판단불가)', () => {
    const m = computeGradeMonotonicity(
      [sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 3 })],
      'd5',
    );
    expect(m.orderedGrades).toHaveLength(1);
    expect(m.comparedPairs).toBe(0);
    expect(m.isMonotonic).toBe(false);
  });
});

describe('buildGradePrecisionMatrix — 통합 + 빈데이터 graceful', () => {
  it('실현표본 0(신호 0)이면 hasData=false, 매트릭스 graceful', () => {
    const gp = buildGradePrecisionMatrix([]);
    expect(gp.hasData).toBe(false);
    expect(gp.confusionD5.sampleCount).toBe(0);
    expect(gp.confusionD5.precision).toBeNull();
    expect(gp.confusionD20.accuracy).toBeNull();
    expect(gp.monotonicityD5.orderedGrades).toEqual([]);
    expect(gp.monotonicityD20.isMonotonic).toBe(false);
  });

  it('신호는 있으나 전부 미실현(arD5/arD20 null)이면 hasData=false', () => {
    const gp = buildGradePrecisionMatrix([
      sig({ arD5: null, arD20: null }),
      sig({ arD5: null, arD20: null }),
    ]);
    expect(gp.hasData).toBe(false);
    expect(gp.confusionD5.sampleCount).toBe(0);
  });

  it('실현표본 ≥1 이면 hasData=true', () => {
    const gp = buildGradePrecisionMatrix([sig({ arD5: 2, arD20: null })]);
    expect(gp.hasData).toBe(true);
    expect(gp.confusionD5.sampleCount).toBe(1);
    expect(gp.confusionD20.sampleCount).toBe(0);
  });
});

describe('buildSignalAccuracyReport — gradePrecision 노출', () => {
  it('리포트에 gradePrecision 매트릭스가 포함된다', () => {
    const returns: SignalRealizedReturn[] = [
      sig({ signalGrade: 'STRONG_BUY_CANDIDATE', arD5: 3, arD20: 5 }),
      sig({ signalGrade: 'WATCH', arD5: -2, arD20: -1 }),
    ];
    const report = buildSignalAccuracyReport(returns);
    expect(report.gradePrecision.hasData).toBe(true);
    expect(report.gradePrecision.confusionD5.truePositive).toBe(1); // STRONG & 양
    expect(report.gradePrecision.confusionD5.trueNegative).toBe(1); // WATCH & 음
  });

  it('빈 입력 리포트도 gradePrecision graceful', () => {
    const report = buildSignalAccuracyReport([]);
    expect(report.gradePrecision.hasData).toBe(false);
    expect(report.gradePrecision.monotonicityD5.orderedGrades).toEqual([]);
  });
});
