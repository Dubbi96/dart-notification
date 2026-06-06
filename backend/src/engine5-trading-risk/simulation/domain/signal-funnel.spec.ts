// 신호→진입 퍼널 리포트 순수함수 테스트 (DAR-109)

import { buildFunnelReport } from './signal-funnel';
import { FunnelDaily } from './simulation.types';

describe('buildFunnelReport (DAR-109 신호→진입 퍼널)', () => {
  it('빈 이력 — daily=[], totals 0, 모든 rate=null(가짜 비율 금지)', () => {
    const r = buildFunnelReport([]);
    expect(r.daily).toEqual([]);
    expect(r.totals).toEqual({
      days: 0,
      signalsGenerated: 0,
      candidatesPassed: 0,
      filled: 0,
      adoptionRate: null,
      fillRate: null,
      conversionRate: null,
    });
  });

  it('일별 전환율 — 채택률/체결률/신호→체결 정확 산출', () => {
    const records: FunnelDaily[] = [
      { tradeDate: '20260101', signalsGenerated: 10, candidatesPassed: 4, filled: 2 },
    ];
    const { daily } = buildFunnelReport(records);
    expect(daily).toHaveLength(1);
    expect(daily[0].adoptionRate).toBeCloseTo(0.4, 10); // 4/10
    expect(daily[0].fillRate).toBeCloseTo(0.5, 10); // 2/4
    expect(daily[0].conversionRate).toBeCloseTo(0.2, 10); // 2/10
  });

  it('분모 0 — 해당 rate만 null, 다른 분모는 정상', () => {
    const records: FunnelDaily[] = [
      // 신호 0 → adoption/conversion null. 후보 0 → fill null.
      { tradeDate: '20260102', signalsGenerated: 0, candidatesPassed: 0, filled: 0 },
    ];
    const { daily } = buildFunnelReport(records);
    expect(daily[0].adoptionRate).toBeNull();
    expect(daily[0].fillRate).toBeNull();
    expect(daily[0].conversionRate).toBeNull();
  });

  it('후보는 통과했으나 체결 0 — fillRate=0(null 아님), adoption은 정상', () => {
    const records: FunnelDaily[] = [
      { tradeDate: '20260103', signalsGenerated: 8, candidatesPassed: 3, filled: 0 },
    ];
    const { daily } = buildFunnelReport(records);
    expect(daily[0].adoptionRate).toBeCloseTo(3 / 8, 10);
    expect(daily[0].fillRate).toBe(0); // 0/3 = 0, 측정 가능
    expect(daily[0].conversionRate).toBe(0);
  });

  it('누적 totals — 전 기간 합산 + 전환율, 거래일 오름차순 정렬', () => {
    const records: FunnelDaily[] = [
      { tradeDate: '20260105', signalsGenerated: 6, candidatesPassed: 3, filled: 1 },
      { tradeDate: '20260104', signalsGenerated: 4, candidatesPassed: 2, filled: 1 },
    ];
    const { daily, totals } = buildFunnelReport(records);
    // 정렬 — 04 먼저
    expect(daily.map((d) => d.tradeDate)).toEqual(['20260104', '20260105']);
    expect(totals.days).toBe(2);
    expect(totals.signalsGenerated).toBe(10);
    expect(totals.candidatesPassed).toBe(5);
    expect(totals.filled).toBe(2);
    expect(totals.adoptionRate).toBeCloseTo(0.5, 10); // 5/10
    expect(totals.fillRate).toBeCloseTo(0.4, 10); // 2/5
    expect(totals.conversionRate).toBeCloseTo(0.2, 10); // 2/10
  });

  it('입력 배열을 변형하지 않는다(불변)', () => {
    const records: FunnelDaily[] = [
      { tradeDate: '20260107', signalsGenerated: 1, candidatesPassed: 1, filled: 1 },
      { tradeDate: '20260106', signalsGenerated: 1, candidatesPassed: 0, filled: 0 },
    ];
    const snapshot = JSON.stringify(records);
    buildFunnelReport(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});
