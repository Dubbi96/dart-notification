/**
 * calibration.spec.ts — 신호 보정 루프 리포트 단위 테스트 (DAR-83)
 *
 * 검증축: 괴리(gap)·suggested delta(감쇠·정수·불변식)·CALIBRATE/ALIGNED/HOLD 판정·
 *   lowSample/통계 미유의/실현표본0/미등재 HOLD·byScoreBand 방향 일관성·빈데이터 graceful·
 *   ★ EVENT_BASE_SCORES 자동변경 없음(상수 불변) 증거.
 */
import {
  buildCalibrationReport,
  calibrateEventScore,
  checkScoreBandConsistency,
  impliedScoreFromReturn,
  SCORE_PER_AR_PCT,
  CALIBRATION_DAMPENING,
  CALIBRATION_GAP_EPSILON,
  calibrateGradeConfidence,
  gradeCoefficientMap,
  applyConfidenceCoefficient,
  EXPECTED_WIN_RATE_BY_GRADE,
  CONFIDENCE_COEFFICIENT_FLOOR,
  NO_DISCOUNT_COEFFICIENT,
} from './calibration';
import {
  AccuracyBucket,
  HorizonAccuracy,
  buildSignalAccuracyReport,
  SignalRealizedReturn,
  LOW_SAMPLE_THRESHOLD,
} from './signal-accuracy';
import { EVENT_BASE_SCORES } from '../buy-signal/config/buy-signal.config';

function horizon(partial: Partial<HorizonAccuracy> = {}): HorizonAccuracy {
  return {
    sampleCount: 10,
    avgExcessReturn: 0,
    medianExcessReturn: 0,
    winRate: 0.5,
    isSignificant: true,
    pValue: 0.01,
    ...partial,
  };
}

function bucket(
  key: string,
  d20: Partial<HorizonAccuracy>,
  d5: Partial<HorizonAccuracy> = d20,
): AccuracyBucket {
  const d20h = horizon(d20);
  return {
    key,
    sampleCount: d20h.sampleCount,
    lowSample: d20h.sampleCount < LOW_SAMPLE_THRESHOLD,
    d5: horizon(d5),
    d20: d20h,
  };
}

describe('impliedScoreFromReturn (실현수익→base score 환산)', () => {
  it('계수 적용 + 정수 반올림', () => {
    expect(SCORE_PER_AR_PCT).toBe(10);
    expect(impliedScoreFromReturn(2.3)).toBe(23);
    expect(impliedScoreFromReturn(-5)).toBe(-50);
  });
  it('±100 clamp', () => {
    expect(impliedScoreFromReturn(15)).toBe(100);
    expect(impliedScoreFromReturn(-20)).toBe(-100);
  });
  it('null 보존', () => {
    expect(impliedScoreFromReturn(null)).toBeNull();
  });
});

describe('calibrateEventScore (EVENT_BASE_SCORES 괴리·권장 delta)', () => {
  it('CALIBRATE: 큰 괴리 → 감쇠된 권장 delta(불변식 new=current+delta)', () => {
    // SUPPLY_CONTRACT base=70; 실현 avg 2% → implied 20; gap=-50; Δ=round(-50*0.5)=-25 → new 45
    const c = calibrateEventScore(bucket('SUPPLY_CONTRACT', { avgExcessReturn: 2 }), 'd20');
    expect(c.currentBaseScore).toBe(70);
    expect(c.impliedScore).toBe(20);
    expect(c.gap).toBe(-50);
    expect(c.suggestedDelta).toBe(-25);
    expect(c.suggestedNewScore).toBe(45);
    expect(c.suggestedNewScore).toBe((c.currentBaseScore as number) + c.suggestedDelta);
    expect(c.status).toBe('CALIBRATE');
  });

  it('delta 는 gap 의 절반(감쇠)으로만 권고', () => {
    expect(CALIBRATION_DAMPENING).toBe(0.5);
    // EARNINGS_SURPRISE base=75; avg 1 → implied 10; gap=-65; Δ=round(-32.5)=-32 → new 43
    const c = calibrateEventScore(bucket('EARNINGS_SURPRISE', { avgExcessReturn: 1 }), 'd20');
    expect(c.gap).toBe(-65);
    expect(c.suggestedDelta).toBe(-32);
    expect(c.suggestedNewScore).toBe(43);
  });

  it('ALIGNED: |gap|<EPSILON → delta 0', () => {
    // SUPPLY_CONTRACT base=70; avg 6.7 → implied 67; gap=-3 (<5) → ALIGNED
    const c = calibrateEventScore(bucket('SUPPLY_CONTRACT', { avgExcessReturn: 6.7 }), 'd20');
    expect(Math.abs(c.gap as number)).toBeLessThan(CALIBRATION_GAP_EPSILON);
    expect(c.status).toBe('ALIGNED');
    expect(c.suggestedDelta).toBe(0);
    expect(c.suggestedNewScore).toBe(70);
  });

  it('HOLD: lowSample(n<5) — 유의해도 보류', () => {
    const c = calibrateEventScore(
      bucket('SUPPLY_CONTRACT', { avgExcessReturn: 2, sampleCount: 3, isSignificant: true }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.lowSample).toBe(true);
    expect(c.suggestedDelta).toBe(0);
    expect(c.gap).toBeNull();
    expect(c.reason).toContain('표본 부족');
  });

  it('HOLD: 통계 미유의(p≥0.05)', () => {
    const c = calibrateEventScore(
      bucket('SUPPLY_CONTRACT', { avgExcessReturn: 2, sampleCount: 30, isSignificant: false }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.suggestedDelta).toBe(0);
    expect(c.reason).toContain('미유의');
  });

  it('HOLD: 실현표본 0', () => {
    const c = calibrateEventScore(
      bucket('SUPPLY_CONTRACT', { sampleCount: 0, avgExcessReturn: null, isSignificant: false }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.impliedScore).toBeNull();
    expect(c.reason).toContain('실현표본 없음');
  });

  it('HOLD: 미등재 eventType (기준 base 없음) — impliedScore 만 참고', () => {
    const c = calibrateEventScore(
      bucket('UNKNOWN_EVENT', { avgExcessReturn: 3, sampleCount: 20, isSignificant: true }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.currentBaseScore).toBeNull();
    expect(c.impliedScore).toBe(30);
    expect(c.suggestedDelta).toBe(0);
    expect(c.reason).toContain('미등재');
  });

  it('지평 선택(d5 vs d20) 반영', () => {
    const b = bucket(
      'SUPPLY_CONTRACT',
      { avgExcessReturn: 2 }, // d20
      { avgExcessReturn: 7 }, // d5
    );
    expect(calibrateEventScore(b, 'd20').impliedScore).toBe(20);
    expect(calibrateEventScore(b, 'd5').impliedScore).toBe(70);
  });
});

describe('checkScoreBandConsistency (byScoreBand 방향 일관성, 진단 전용)', () => {
  it('고점수 구간 + 양수익 → 일관(ALIGNED)', () => {
    const c = checkScoreBandConsistency(
      bucket('80+ (STRONG_BUY)', { avgExcessReturn: 3, isSignificant: true }),
      'd20',
    );
    expect(c.expectedDirection).toBe(1);
    expect(c.directionConsistent).toBe(true);
    expect(c.status).toBe('ALIGNED');
  });

  it('고점수 구간 + 음수익 → 불일치(CALIBRATE)', () => {
    const c = checkScoreBandConsistency(
      bucket('80+ (STRONG_BUY)', { avgExcessReturn: -3, isSignificant: true }),
      'd20',
    );
    expect(c.directionConsistent).toBe(false);
    expect(c.status).toBe('CALIBRATE');
    expect(c.reason).toContain('불일치');
  });

  it("'<0' 구간 + 음수익 → 일관", () => {
    const c = checkScoreBandConsistency(
      bucket('<0', { avgExcessReturn: -2, isSignificant: true }),
      'd20',
    );
    expect(c.expectedDirection).toBe(-1);
    expect(c.directionConsistent).toBe(true);
    expect(c.status).toBe('ALIGNED');
  });

  it('lowSample → HOLD(directionConsistent null)', () => {
    const c = checkScoreBandConsistency(
      bucket('80+ (STRONG_BUY)', { avgExcessReturn: 3, sampleCount: 2, isSignificant: true }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.directionConsistent).toBeNull();
  });

  it('통계 미유의 → HOLD', () => {
    const c = checkScoreBandConsistency(
      bucket('80+ (STRONG_BUY)', { avgExcessReturn: 3, sampleCount: 30, isSignificant: false }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.directionConsistent).toBeNull();
  });
});

describe('buildCalibrationReport (통합 — SignalAccuracyReport 재사용)', () => {
  function sig(p: Partial<SignalRealizedReturn>): SignalRealizedReturn {
    return {
      signalGrade: 'BUY_CANDIDATE',
      buyScore: 65,
      eventType: 'SUPPLY_CONTRACT',
      arD5: 1,
      arD20: 2,
      ...p,
    };
  }

  it('source 요약 + 진단 배열이 byEventType/byScoreBand 와 1:1', () => {
    const accuracy = buildSignalAccuracyReport([
      sig({ eventType: 'SUPPLY_CONTRACT', arD5: 1, arD20: 2 }),
      sig({ eventType: 'EARNINGS_SHOCK', arD5: -1, arD20: -3 }),
      sig({ eventType: 'SUPPLY_CONTRACT', arD5: 2, arD20: 3 }),
    ]);
    const report = buildCalibrationReport(accuracy);
    expect(report.source.totalSignals).toBe(3);
    expect(report.eventScoreCalibrationsD5).toHaveLength(accuracy.byEventType.length);
    expect(report.eventScoreCalibrationsD20).toHaveLength(accuracy.byEventType.length);
    expect(report.scoreBandConsistencyD20).toHaveLength(accuracy.byScoreBand.length);
  });

  it('소표본 → 전부 HOLD(과신 방지)', () => {
    const accuracy = buildSignalAccuracyReport([
      sig({ eventType: 'SUPPLY_CONTRACT', arD5: 1, arD20: 2 }),
    ]);
    const report = buildCalibrationReport(accuracy);
    expect(report.eventScoreCalibrationsD20.every((c) => c.status === 'HOLD')).toBe(true);
  });

  it('빈데이터 graceful', () => {
    const report = buildCalibrationReport(buildSignalAccuracyReport([]));
    expect(report.source.totalSignals).toBe(0);
    expect(report.eventScoreCalibrationsD20).toEqual([]);
    expect(report.scoreBandConsistencyD20).toEqual([]);
  });

  it('assumptions·disclaimer 노출(투명성/자동적용 금지 고지)', () => {
    const report = buildCalibrationReport(buildSignalAccuracyReport([]));
    expect(report.assumptions.scorePerArPct).toBe(10);
    expect(report.assumptions.dampening).toBe(0.5);
    expect(report.assumptions.lowSampleThreshold).toBe(LOW_SAMPLE_THRESHOLD);
    expect(report.disclaimer).toContain('자동');
    expect(report.disclaimer).toContain('PR');
  });
});

describe('★ 자동적용 금지 — EVENT_BASE_SCORES 상수 불변 증거', () => {
  it('보정 리포트 생성 전/후 EVENT_BASE_SCORES 가 변경되지 않는다', () => {
    const before = JSON.parse(JSON.stringify(EVENT_BASE_SCORES));
    // 큰 delta 를 권고할 입력(SUPPLY_CONTRACT 70 vs 실현 2% → 권장 -25)이라도 상수는 불변이어야.
    const accuracy = buildSignalAccuracyReport(
      Array.from({ length: 30 }, () => ({
        signalGrade: 'BUY_CANDIDATE',
        buyScore: 65,
        eventType: 'SUPPLY_CONTRACT',
        arD5: 2,
        arD20: 2,
      })),
    );
    const report = buildCalibrationReport(accuracy);
    // 리포트는 권고값만 담고(상수와 별개 객체), 원본 상수는 그대로.
    expect(EVENT_BASE_SCORES).toEqual(before);
    expect(EVENT_BASE_SCORES.SUPPLY_CONTRACT).toBe(before.SUPPLY_CONTRACT);
    // 권고값은 리포트 안에만 존재
    const sc = report.eventScoreCalibrationsD20.find((c) => c.eventType === 'SUPPLY_CONTRACT');
    expect(sc?.suggestedNewScore).not.toBe(EVENT_BASE_SCORES.SUPPLY_CONTRACT);
  });
});

// ── DAR-91: 등급별 confidence 자기보정 계수 ────────────────────────────
describe('calibrateGradeConfidence (등급 confidence 보정계수)', () => {
  it('과대평가 등급(실현 승률 < 기대) → 감쇠 디스카운트 계수(<1)', () => {
    // STRONG_BUY_CANDIDATE 기대 0.55, 실현 0.33 → ratio=0.6 → damped=1-0.5*(1-0.6)=0.8
    const c = calibrateGradeConfidence(
      bucket('STRONG_BUY_CANDIDATE', { winRate: 0.33, sampleCount: 20, isSignificant: true }),
      'd20',
    );
    expect(c.expectedWinRate).toBe(0.55);
    expect(c.status).toBe('CALIBRATE');
    expect(c.coefficient).toBeCloseTo(0.8, 5);
    expect(c.coefficient).toBeLessThan(NO_DISCOUNT_COEFFICIENT);
  });

  it('기대 충족/초과 → 디스카운트 없음(계수 1.0, 증폭 금지)', () => {
    const meets = calibrateGradeConfidence(
      bucket('BUY_CANDIDATE', { winRate: 0.5, sampleCount: 20, isSignificant: true }),
      'd20',
    );
    expect(meets.status).toBe('ALIGNED');
    expect(meets.coefficient).toBe(1.0);
    // 기대 초과여도 1.0 상한(증폭하지 않음)
    const exceeds = calibrateGradeConfidence(
      bucket('BUY_CANDIDATE', { winRate: 0.9, sampleCount: 20, isSignificant: true }),
      'd20',
    );
    expect(exceeds.coefficient).toBe(1.0);
  });

  it('표본 부족(lowSample) → 무보정(계수 1.0, 과신 방지)', () => {
    const c = calibrateGradeConfidence(
      bucket('STRONG_BUY_CANDIDATE', {
        winRate: 0.0,
        sampleCount: LOW_SAMPLE_THRESHOLD - 1,
        isSignificant: true,
      }),
      'd20',
    );
    expect(c.lowSample).toBe(true);
    expect(c.status).toBe('HOLD');
    expect(c.coefficient).toBe(1.0);
  });

  it('통계 미유의 → 무보정(계수 1.0, 과신 방지)', () => {
    const c = calibrateGradeConfidence(
      bucket('STRONG_BUY_CANDIDATE', { winRate: 0.0, sampleCount: 30, isSignificant: false }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.coefficient).toBe(1.0);
  });

  it('실현표본 0 → 무보정(계수 1.0)', () => {
    const c = calibrateGradeConfidence(
      bucket('BUY_CANDIDATE', { winRate: null, sampleCount: 0, isSignificant: false }),
      'd20',
    );
    expect(c.status).toBe('HOLD');
    expect(c.coefficient).toBe(1.0);
  });

  it('비매수/미등재 등급(NEUTRAL/AVOID 등) → 보정 대상 아님(계수 1.0)', () => {
    for (const g of ['NEUTRAL', 'AVOID', 'BLOCKED']) {
      const c = calibrateGradeConfidence(
        bucket(g, { winRate: 0.0, sampleCount: 50, isSignificant: true }),
        'd20',
      );
      expect(c.expectedWinRate).toBeNull();
      expect(c.coefficient).toBe(1.0);
    }
  });

  it('계수 하한 clamp: 극단적 부진도 FLOOR 미만으로 내려가지 않는다', () => {
    // winRate 0 → ratio 0 → damped=1-0.5=0.5 == FLOOR. 더 큰 감쇠여도 FLOOR 보장.
    const c = calibrateGradeConfidence(
      bucket('STRONG_BUY_CANDIDATE', { winRate: 0.0, sampleCount: 40, isSignificant: true }),
      'd20',
    );
    expect(c.coefficient).toBeGreaterThanOrEqual(CONFIDENCE_COEFFICIENT_FLOOR);
  });
});

describe('gradeCoefficientMap / applyConfidenceCoefficient (환류 적용)', () => {
  it('gradeCoefficientMap: grade→coefficient 맵 구성(1.0 포함)', () => {
    const calibrations = [
      calibrateGradeConfidence(
        bucket('STRONG_BUY_CANDIDATE', { winRate: 0.33, sampleCount: 20, isSignificant: true }),
        'd20',
      ),
      calibrateGradeConfidence(
        bucket('BUY_CANDIDATE', { winRate: 0.9, sampleCount: 20, isSignificant: true }),
        'd20',
      ),
    ];
    const m = gradeCoefficientMap(calibrations);
    expect(m.get('STRONG_BUY_CANDIDATE')).toBeCloseTo(0.8, 5);
    expect(m.get('BUY_CANDIDATE')).toBe(1.0);
  });

  it('applyConfidenceCoefficient: buyScore×계수(정수·clamp), 계수 1.0=원값 보존', () => {
    expect(applyConfidenceCoefficient(85, 0.8)).toBe(68);
    expect(applyConfidenceCoefficient(85, 1.0)).toBe(85);
    expect(applyConfidenceCoefficient(85, NO_DISCOUNT_COEFFICIENT)).toBe(85);
    // clamp ±100
    expect(applyConfidenceCoefficient(100, 1.0)).toBe(100);
  });

  it('EXPECTED_WIN_RATE_BY_GRADE: 매수 상위등급일수록 기대 승률 단조(우월성 보존)', () => {
    expect(EXPECTED_WIN_RATE_BY_GRADE.STRONG_BUY_CANDIDATE).toBeGreaterThan(
      EXPECTED_WIN_RATE_BY_GRADE.BUY_CANDIDATE,
    );
    expect(EXPECTED_WIN_RATE_BY_GRADE.BUY_CANDIDATE).toBeGreaterThan(
      EXPECTED_WIN_RATE_BY_GRADE.WATCH,
    );
  });

  it('buildCalibrationReport: gradeConfidenceCalibrationsD20 동봉(byGrade 기반)', () => {
    const accuracy = buildSignalAccuracyReport(
      Array.from({ length: 20 }, () => ({
        signalGrade: 'STRONG_BUY_CANDIDATE',
        buyScore: 85,
        eventType: 'SUPPLY_CONTRACT',
        // 전부 음수익 → 승률 0 → 과대평가 → 디스카운트
        arD5: -1,
        arD20: -1,
      })),
    );
    const report = buildCalibrationReport(accuracy);
    const g = report.gradeConfidenceCalibrationsD20.find(
      (x) => x.grade === 'STRONG_BUY_CANDIDATE',
    );
    expect(g).toBeDefined();
    expect(g?.status).toBe('CALIBRATE');
    expect(g?.coefficient).toBeLessThan(1.0);
  });
});
