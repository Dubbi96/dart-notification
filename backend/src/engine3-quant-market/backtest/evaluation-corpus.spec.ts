/**
 * evaluation-corpus.spec.ts — 평가자료 코퍼스 순수 빌더 결정론 검증 (DAR-379)
 */
import {
  buildCorpusRecord,
  buildEvaluationCorpusReport,
  CorpusRecordInput,
  labelDirection,
  polarityDirection,
} from './evaluation-corpus';

function input(over: Partial<CorpusRecordInput> = {}): CorpusRecordInput {
  return {
    rcpNo: over.rcpNo ?? '20260101000001',
    corpCode: over.corpCode ?? '00000001',
    eventType: over.eventType ?? 'SUPPLY_CONTRACT',
    bucketKey: over.bucketKey ?? 'SUPPLY_CONTRACT__ALL',
    predictedPolarity: over.predictedPolarity ?? 'POSITIVE',
    predictedConfidence: over.predictedConfidence ?? 0.9,
    isAiAssisted: over.isAiAssisted ?? false,
    aiTaskCount: over.aiTaskCount ?? 0,
    hasAiSummary: over.hasAiSummary ?? false,
    d0Date: over.d0Date ?? '20260102',
    realizedArD5: over.realizedArD5 ?? null,
    realizedArD20: over.realizedArD20 ?? null,
    isUpD5: over.isUpD5 ?? null,
    isCrashD5: over.isCrashD5 ?? null,
    maxDrawdown: over.maxDrawdown ?? null,
    ...over,
  };
}

describe('polarityDirection', () => {
  it('POSITIVE→+1, NEGATIVE→-1, MIXED/UNKNOWN/기타→0', () => {
    expect(polarityDirection('POSITIVE')).toBe(1);
    expect(polarityDirection('positive')).toBe(1);
    expect(polarityDirection('NEGATIVE')).toBe(-1);
    expect(polarityDirection('MIXED')).toBe(0);
    expect(polarityDirection('UNKNOWN')).toBe(0);
    expect(polarityDirection('')).toBe(0);
  });
});

describe('labelDirection (일치/괴리/중립)', () => {
  it('실현결과 없음 → NEUTRAL(판정불가)', () => {
    expect(labelDirection(1, null)).toBe('NEUTRAL');
    expect(labelDirection(-1, null)).toBe('NEUTRAL');
  });
  it('방향예측 없음(0) → NEUTRAL', () => {
    expect(labelDirection(0, 5)).toBe('NEUTRAL');
    expect(labelDirection(0, -5)).toBe('NEUTRAL');
  });
  it('정확히 0 실현 → NEUTRAL', () => {
    expect(labelDirection(1, 0)).toBe('NEUTRAL');
  });
  it('부호 일치 → AGREE', () => {
    expect(labelDirection(1, 3.2)).toBe('AGREE');
    expect(labelDirection(-1, -4.1)).toBe('AGREE'); // 음/음 = 방향 일치
  });
  it('부호 불일치 → DIVERGE', () => {
    expect(labelDirection(1, -2.0)).toBe('DIVERGE');
    expect(labelDirection(-1, 6.5)).toBe('DIVERGE');
  });
});

describe('buildCorpusRecord', () => {
  it('POSITIVE 사전 + D+5 +양수 → AGREE, 미성숙 D+20 → NEUTRAL', () => {
    const r = buildCorpusRecord(input({ predictedPolarity: 'POSITIVE', realizedArD5: 4.2, realizedArD20: null }));
    expect(r.labelD5).toBe('AGREE');
    expect(r.labelD20).toBe('NEUTRAL');
    expect(r.hasOutcomeD5).toBe(true);
    expect(r.hasOutcomeD20).toBe(false);
  });
  it('NEGATIVE 사전 + D+5 +양수 → DIVERGE', () => {
    const r = buildCorpusRecord(input({ predictedPolarity: 'NEGATIVE', realizedArD5: 3.0 }));
    expect(r.labelD5).toBe('DIVERGE');
  });
});

describe('buildEvaluationCorpusReport (집계·결정론)', () => {
  it('이벤트유형별 hitRate·커버리지·요약을 결정론적으로 산출', () => {
    const records = [
      // SUPPLY_CONTRACT: 사전 POSITIVE 3건 — D5 +/+/- → agree2 diverge1, hitRate 66.67
      buildCorpusRecord(input({ rcpNo: 'a1', eventType: 'SUPPLY_CONTRACT', predictedPolarity: 'POSITIVE', realizedArD5: 5, realizedArD20: 8, hasAiSummary: true, aiTaskCount: 2 })),
      buildCorpusRecord(input({ rcpNo: 'a2', eventType: 'SUPPLY_CONTRACT', predictedPolarity: 'POSITIVE', realizedArD5: 2, realizedArD20: -1, hasAiSummary: true, aiTaskCount: 1 })),
      buildCorpusRecord(input({ rcpNo: 'a3', eventType: 'SUPPLY_CONTRACT', predictedPolarity: 'POSITIVE', realizedArD5: -3, realizedArD20: -4, hasAiSummary: false })),
      // EARNINGS_SHOCK: NEGATIVE 1 (D5 -10 → AGREE), 미성숙 1 (outcome 없음 → NEUTRAL, 커버리지 분리)
      buildCorpusRecord(input({ rcpNo: 'b1', eventType: 'EARNINGS_SHOCK', predictedPolarity: 'NEGATIVE', realizedArD5: -10, realizedArD20: -12, hasAiSummary: true })),
      buildCorpusRecord(input({ rcpNo: 'b2', eventType: 'EARNINGS_SHOCK', predictedPolarity: 'NEGATIVE', realizedArD5: null, realizedArD20: null, hasAiSummary: false })),
    ];

    const report = buildEvaluationCorpusReport(records);

    // 요약
    expect(report.summary.totalRecords).toBe(5);
    expect(report.summary.distinctEventTypes).toBe(2);
    expect(report.summary.withAiCount).toBe(3); // a1,a2,b1
    expect(report.summary.withOutcomeD5Count).toBe(4); // a1,a2,a3,b1 (b2 미성숙)
    expect(report.summary.aiCoveragePct).toBe(60); // 3/5
    expect(report.summary.outcomeCoverageD5Pct).toBe(80); // 4/5
    // 전체 D5: agree = a1,a2,b1 =3 / diverge = a3 =1 / neutral = b2 =1
    expect(report.summary.agreeD5).toBe(3);
    expect(report.summary.divergeD5).toBe(1);
    expect(report.summary.neutralD5).toBe(1);
    expect(report.summary.hitRateD5).toBe(75); // 3/(3+1)

    // 정렬: 레코드 수 내림차순 → SUPPLY_CONTRACT(3) 먼저
    expect(report.byEventType[0].key).toBe('SUPPLY_CONTRACT');
    const sc = report.byEventType[0];
    expect(sc.recordCount).toBe(3);
    expect(sc.agreeD5).toBe(2);
    expect(sc.divergeD5).toBe(1);
    expect(sc.hitRateD5).toBe(66.67);
    expect(sc.meanArD5).toBe(round2((5 + 2 - 3) / 3));
    expect(sc.aiCoveragePct).toBe(66.67); // 2/3

    const es = report.byEventType[1];
    expect(es.key).toBe('EARNINGS_SHOCK');
    expect(es.recordCount).toBe(2);
    expect(es.withOutcomeD5Count).toBe(1); // b2 미성숙 제외
    expect(es.outcomeCoverageD5Pct).toBe(50);
    expect(es.hitRateD5).toBe(100); // b1 agree, b2 neutral(판정제외)
    expect(es.meanArD5).toBe(-10);

    // disclaimer 불변
    expect(report.disclaimer).toContain('CORPUS_REFERENCE_ONLY');
  });

  it('빈 입력 → 0 요약(에러 아님)', () => {
    const report = buildEvaluationCorpusReport([]);
    expect(report.summary.totalRecords).toBe(0);
    expect(report.summary.hitRateD5).toBeNull();
    expect(report.byEventType).toEqual([]);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
