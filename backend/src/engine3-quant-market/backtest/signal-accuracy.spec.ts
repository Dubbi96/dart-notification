/**
 * signal-accuracy.spec.ts — 신호 사후검증 집계 단위 테스트 (DAR-73)
 *
 * 검증축: 그룹핑(등급/구간/eventType)·D+5/D+20 통계·LOW_SAMPLE 표기·승률·중앙값·유의성.
 */
import {
  median,
  scoreBandOf,
  computeHorizonAccuracy,
  aggregateBucket,
  buildSignalAccuracyReport,
  dedupByDisclosureEvent,
  stratifySampleByMonth,
  defaultAccuracyWindow,
  LOW_SAMPLE_THRESHOLD,
  SIGNIFICANCE_MIN_SAMPLE,
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

describe('median', () => {
  it('빈 배열은 null', () => {
    expect(median([])).toBeNull();
  });
  it('홀수 길이는 중간값', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('짝수 길이는 두 중간값 평균', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('scoreBandOf (등급 임계값 정렬)', () => {
  // F9(2026-06-26): 라벨이 SIGNAL_GRADE_THRESHOLDS(50/45/30)에서 파생됨.
  it('50 이상 → STRONG_BUY 구간', () => {
    expect(scoreBandOf(50)).toBe('50+ (STRONG_BUY)');
    expect(scoreBandOf(100)).toBe('50+ (STRONG_BUY)');
  });
  it('45~49 → BUY 구간', () => {
    expect(scoreBandOf(45)).toBe('45-49 (BUY)');
    expect(scoreBandOf(49)).toBe('45-49 (BUY)');
  });
  it('30~44 → WATCH 구간', () => {
    expect(scoreBandOf(30)).toBe('30-44 (WATCH)');
    expect(scoreBandOf(44)).toBe('30-44 (WATCH)');
  });
  it('0~29 / 음수 구간', () => {
    expect(scoreBandOf(0)).toBe('0-29');
    expect(scoreBandOf(29)).toBe('0-29');
    expect(scoreBandOf(-10)).toBe('<0');
  });
});

describe('computeHorizonAccuracy', () => {
  it('빈 표본은 모두 null / 비유의', () => {
    const h = computeHorizonAccuracy([]);
    expect(h.sampleCount).toBe(0);
    expect(h.avgExcessReturn).toBeNull();
    expect(h.medianExcessReturn).toBeNull();
    expect(h.winRate).toBeNull();
    expect(h.isSignificant).toBe(false);
    expect(h.pValue).toBeNull();
  });

  it('평균·중앙값·승률을 정확히 산출', () => {
    const h = computeHorizonAccuracy([2, 4, -1, 3]); // 양수 3/4
    expect(h.sampleCount).toBe(4);
    expect(h.avgExcessReturn).toBe(2); // (2+4-1+3)/4 = 2
    expect(h.medianExcessReturn).toBe(2.5); // 정렬 [-1,2,3,4] → (2+3)/2
    expect(h.winRate).toBe(0.75);
  });

  it('표본<SIGNIFICANCE_MIN_SAMPLE 이면 isSignificant=false 고정', () => {
    // 분산 0 + 양수평균이면 t=Infinity, p=0 이지만 표본부족으로 비유의여야 한다
    const small = computeHorizonAccuracy([5, 5, 5, 5]); // n=4 < 5
    expect(small.sampleCount).toBe(4);
    expect(small.isSignificant).toBe(false);
  });

  it('표본 충분 + 일관된 양수면 유의', () => {
    const big = computeHorizonAccuracy([5, 5, 5, 5, 5]); // n=5, 분산0 양수 → p≈0
    expect(big.sampleCount).toBe(SIGNIFICANCE_MIN_SAMPLE);
    expect(big.isSignificant).toBe(true);
    expect(big.pValue).toBe(0);
  });

  it('n=1 이면 pValue null, 비유의', () => {
    const one = computeHorizonAccuracy([3]);
    expect(one.pValue).toBeNull();
    expect(one.isSignificant).toBe(false);
    expect(one.winRate).toBe(1);
  });

  // DAR-410 — 이상치 오염 차단: robust(median) 축이 산술평균과 분리되는지.
  it('이상치 오염 시 avgExcessReturn 은 양(+)이지만 robust(median) 은 음(-)', () => {
    // 90% 음수 + 소수 극단 폭등(BLOCKED 등급 실측 패턴 재현): 다수 손실인데 평균만 양.
    const vals = [-6, -7, -5, -6, -8, -6, -7, -5, -6, +200]; // 9개 음수 + 1개 폭등
    const h = computeHorizonAccuracy(vals);
    expect(h.avgExcessReturn).toBeGreaterThan(0); // 평균은 폭등 1개에 오염되어 양(+)
    expect(h.medianExcessReturn).toBeLessThan(0); // 중앙값은 음(-) = 전형적 손실
    expect(h.robustExcessReturn).toBe(h.medianExcessReturn); // ★robust = median(이상치 불변)
    expect(h.robustExcessReturn).toBeLessThan(0); // 단일 폭등에도 음(-) 유지
    expect(h.winRate).toBe(0.1); // 10%만 양수익 — 회피 등급의 진짜 모습
  });
});

describe('aggregateBucket — LOW_SAMPLE 표기 + null 제외', () => {
  it('표본<임계면 lowSample=true', () => {
    const b = aggregateBucket('X', [sig({}), sig({})]);
    expect(b.sampleCount).toBe(2);
    expect(b.lowSample).toBe(true);
  });

  it('표본≥임계면 lowSample=false', () => {
    const group = Array.from({ length: LOW_SAMPLE_THRESHOLD }, () => sig({}));
    const b = aggregateBucket('X', group);
    expect(b.sampleCount).toBe(LOW_SAMPLE_THRESHOLD);
    expect(b.lowSample).toBe(false);
  });

  it('arD5/arD20 null 표본은 해당 지평 집계에서 제외', () => {
    const b = aggregateBucket('X', [
      sig({ arD5: 2, arD20: null }),
      sig({ arD5: 4, arD20: 6 }),
      sig({ arD5: null, arD20: null }),
    ]);
    expect(b.sampleCount).toBe(3); // 그룹 표본은 전체 3
    expect(b.d5.sampleCount).toBe(2); // arD5 산출가능 2건
    expect(b.d5.avgExcessReturn).toBe(3);
    expect(b.d20.sampleCount).toBe(1); // arD20 산출가능 1건
    expect(b.d20.avgExcessReturn).toBe(6);
  });
});

describe('buildSignalAccuracyReport — 등급/구간/eventType 그룹', () => {
  const returns: SignalRealizedReturn[] = [
    sig({ signalGrade: 'STRONG_BUY_CANDIDATE', buyScore: 85, eventType: 'SUPPLY_CONTRACT', arD5: 3, arD20: 5 }),
    sig({ signalGrade: 'STRONG_BUY_CANDIDATE', buyScore: 90, eventType: 'SUPPLY_CONTRACT', arD5: 1, arD20: 4 }),
    sig({ signalGrade: 'BUY_CANDIDATE', buyScore: 47, eventType: 'DIVIDEND_INCREASE', arD5: -2, arD20: 1 }),
    sig({ signalGrade: 'WATCH', buyScore: 40, eventType: 'LAWSUIT', arD5: -5, arD20: -8 }),
  ];

  it('등급별 그룹 수와 표본', () => {
    const report = buildSignalAccuracyReport(returns);
    expect(report.totalSignals).toBe(4);
    expect(report.realizedD5).toBe(4);
    expect(report.realizedD20).toBe(4);
    const grades = report.byGrade.map((b) => b.key).sort();
    expect(grades).toEqual(['BUY_CANDIDATE', 'STRONG_BUY_CANDIDATE', 'WATCH']);
    const strong = report.byGrade.find((b) => b.key === 'STRONG_BUY_CANDIDATE')!;
    expect(strong.sampleCount).toBe(2);
    expect(strong.d5.avgExcessReturn).toBe(2); // (3+1)/2
    expect(strong.d20.avgExcessReturn).toBe(4.5); // (5+4)/2
  });

  it('점수 구간이 임계값 내림차순으로 정렬', () => {
    const report = buildSignalAccuracyReport(returns);
    expect(report.byScoreBand.map((b) => b.key)).toEqual([
      '50+ (STRONG_BUY)',
      '45-49 (BUY)',
      '30-44 (WATCH)',
    ]);
  });

  it('eventType 그룹은 표본 많은 순', () => {
    const report = buildSignalAccuracyReport(returns);
    expect(report.byEventType[0].key).toBe('SUPPLY_CONTRACT'); // 2건으로 최다
    expect(report.byEventType[0].sampleCount).toBe(2);
  });

  it('overall 은 전체 표본 집계', () => {
    const report = buildSignalAccuracyReport(returns);
    expect(report.overall.key).toBe('ALL');
    expect(report.overall.sampleCount).toBe(4);
    expect(report.overall.d5.winRate).toBe(0.5); // 양수 2/4 (3,1)
  });

  it('빈 입력도 안전(전부 null/0)', () => {
    const report = buildSignalAccuracyReport([]);
    expect(report.totalSignals).toBe(0);
    expect(report.overall.sampleCount).toBe(0);
    expect(report.overall.lowSample).toBe(true);
    expect(report.byGrade).toEqual([]);
  });
});

// ── TB-2 (2026-07-03) — 표본 설계 순수 함수: dedup·월별 층화·기본 기간 ──────

describe('dedupByDisclosureEvent — (rcpNo,eventType) persona 복제 제거 (TB-2)', () => {
  const row = (rcpNo: string, eventType: string, persona: string) => ({
    rcpNo,
    eventType,
    persona,
  });

  it('동일 (rcpNo,eventType) persona 4행 → 대표 1행(입력 순서상 첫 행)', () => {
    const rows = [
      row('R1', 'SUPPLY_CONTRACT', 'EVENT_DRIVEN'), // 사전순 첫 persona = 대표
      row('R1', 'SUPPLY_CONTRACT', 'GROWTH'),
      row('R1', 'SUPPLY_CONTRACT', 'MOMENTUM'),
      row('R1', 'SUPPLY_CONTRACT', 'VALUE'),
    ];
    const out = dedupByDisclosureEvent(rows);
    expect(out).toHaveLength(1);
    expect(out[0].persona).toBe('EVENT_DRIVEN'); // 대표 선정 규칙: 첫 행
  });

  it('rcpNo 또는 eventType 이 다르면 별도 표본으로 유지', () => {
    const rows = [
      row('R1', 'SUPPLY_CONTRACT', 'GROWTH'),
      row('R1', 'SHARE_BUYBACK', 'GROWTH'), // 같은 공시·다른 이벤트 → 유지
      row('R2', 'SUPPLY_CONTRACT', 'GROWTH'), // 다른 공시 → 유지
    ];
    expect(dedupByDisclosureEvent(rows)).toHaveLength(3);
  });

  it('빈 입력 → 빈 출력', () => {
    expect(dedupByDisclosureEvent([])).toEqual([]);
  });
});

describe('stratifySampleByMonth — 월별 균등 추출 (TB-2)', () => {
  const row = (id: string, rcpDt: string | null) => ({ id, rcpDt });

  it('limit 이 표본보다 작으면 라운드로빈으로 월별 균등 추출', () => {
    const rows = [
      // 202501: 3행 / 202506: 2행 / 202512: 1행
      row('a1', '20250103'),
      row('a2', '20250110'),
      row('a3', '20250120'),
      row('b1', '20250602'),
      row('b2', '20250630'),
      row('c1', '20251215'),
    ];
    const out = stratifySampleByMonth(rows, 3);
    // 1라운드: 각 월 첫 행 1개씩 — 균등.
    expect(out.map((r) => r.id)).toEqual(['a1', 'b1', 'c1']);
  });

  it('부족한 월은 있는 만큼만, 잔여 쿼터는 다른 월로(전량 활용)', () => {
    const rows = [
      row('a1', '20250103'),
      row('a2', '20250110'),
      row('a3', '20250120'),
      row('b1', '20250602'),
    ];
    const out = stratifySampleByMonth(rows, 3);
    // 1라운드 a1,b1 → 2라운드 a2 (b 월 소진).
    expect(out.map((r) => r.id)).toEqual(['a1', 'b1', 'a2']);
  });

  it('표본 ≤ limit 이면 전량 반환(층화 불필요·순서 보존)', () => {
    const rows = [row('a1', '20250103'), row('b1', '20250602')];
    expect(stratifySampleByMonth(rows, 10).map((r) => r.id)).toEqual(['a1', 'b1']);
  });

  it('rcpDt 결측 행은 UNKNOWN 월 버킷으로 graceful 포함', () => {
    const rows = [row('a1', '20250103'), row('u1', null), row('a2', '20250110')];
    const out = stratifySampleByMonth(rows, 2);
    // 월 키 정렬: '202501' < 'UNKNOWN'(숫자 뒤) — 각 버킷 1행씩.
    expect(out.map((r) => r.id)).toEqual(['a1', 'u1']);
  });

  it('limit 0/음수 → 빈 표본', () => {
    expect(stratifySampleByMonth([row('a1', '20250103')], 0)).toEqual([]);
  });
});

describe('defaultAccuracyWindow — 기본 기간(최근 12개월, KST) (TB-2)', () => {
  it('고정 now 기준 from=12개월 전 같은 날, to=오늘(KST)', () => {
    // 2026-07-03 00:00 UTC = 2026-07-03 09:00 KST
    const w = defaultAccuracyWindow(new Date(Date.UTC(2026, 6, 3)));
    expect(w).toEqual({ from: '20250703', to: '20260703' });
  });

  it('KST 날짜 경계: UTC 15시 이후는 KST 다음날', () => {
    // 2026-07-03 16:00 UTC = 2026-07-04 01:00 KST
    const w = defaultAccuracyWindow(new Date(Date.UTC(2026, 6, 3, 16)));
    expect(w).toEqual({ from: '20250704', to: '20260704' });
  });

  it('연초 언더플로 정규화(1월 → 전년 1월)', () => {
    const w = defaultAccuracyWindow(new Date(Date.UTC(2026, 0, 15)));
    expect(w).toEqual({ from: '20250115', to: '20260115' });
  });
});
