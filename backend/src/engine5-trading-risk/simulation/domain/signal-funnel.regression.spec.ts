// 회귀 안전망 (DAR-127): 신호→진입 퍼널 — 분모 0 보호(가짜 비율 금지)·정렬·누적 합산.
// 기존 signal-funnel.spec.ts 보완: null 비율 경계·날짜 정렬·총계 일관.
import { buildFunnelReport } from './signal-funnel';
import { FunnelDaily } from './simulation.types';

const day = (
  tradeDate: string,
  signalsGenerated: number,
  candidatesPassed: number,
  filled: number,
): FunnelDaily => ({ tradeDate, signalsGenerated, candidatesPassed, filled });

describe('buildFunnelReport (DAR-127 회귀 안전망)', () => {
  it('전환율 = 비율 계산(채택률·체결률·신호→체결)', () => {
    const r = buildFunnelReport([day('20260102', 10, 4, 2)]);
    const d = r.daily[0];
    expect(d.adoptionRate).toBeCloseTo(0.4); // 4/10
    expect(d.fillRate).toBeCloseTo(0.5); // 2/4
    expect(d.conversionRate).toBeCloseTo(0.2); // 2/10
  });

  it('분모 0 → null (가짜 비율 금지)', () => {
    const r = buildFunnelReport([day('20260102', 0, 0, 0)]);
    const d = r.daily[0];
    expect(d.adoptionRate).toBeNull();
    expect(d.fillRate).toBeNull();
    expect(d.conversionRate).toBeNull();
  });

  it('신호는 있으나 후보 0 → adoption=0, fill=null', () => {
    const r = buildFunnelReport([day('20260102', 5, 0, 0)]);
    const d = r.daily[0];
    expect(d.adoptionRate).toBe(0);
    expect(d.fillRate).toBeNull();
    expect(d.conversionRate).toBe(0);
  });

  it('입력 순서와 무관하게 거래일 오름차순 정렬', () => {
    const r = buildFunnelReport([
      day('20260105', 1, 1, 1),
      day('20260101', 2, 2, 2),
      day('20260103', 3, 3, 3),
    ]);
    expect(r.daily.map((d) => d.tradeDate)).toEqual(['20260101', '20260103', '20260105']);
  });

  it('동일 거래일은 정렬에서 순서 보존(비교자 0 경로)', () => {
    const r = buildFunnelReport([day('20260101', 1, 1, 1), day('20260101', 2, 2, 2)]);
    expect(r.daily).toHaveLength(2);
    expect(r.daily.every((d) => d.tradeDate === '20260101')).toBe(true);
  });

  it('누적 총계 = 일별 합산 + 운용일수', () => {
    const r = buildFunnelReport([day('20260101', 10, 5, 3), day('20260102', 6, 2, 1)]);
    expect(r.totals.days).toBe(2);
    expect(r.totals.signalsGenerated).toBe(16);
    expect(r.totals.candidatesPassed).toBe(7);
    expect(r.totals.filled).toBe(4);
    expect(r.totals.adoptionRate).toBeCloseTo(7 / 16);
    expect(r.totals.conversionRate).toBeCloseTo(4 / 16);
  });

  it('빈 입력 → 일별 빈 배열 + 총계 전부 0·비율 null', () => {
    const r = buildFunnelReport([]);
    expect(r.daily).toEqual([]);
    expect(r.totals.days).toBe(0);
    expect(r.totals.adoptionRate).toBeNull();
    expect(r.totals.fillRate).toBeNull();
    expect(r.totals.conversionRate).toBeNull();
  });

  it('원본 배열을 변형하지 않음(불변)', () => {
    const input = [day('20260105', 1, 1, 1), day('20260101', 2, 2, 2)];
    const snapshot = input.map((d) => d.tradeDate);
    buildFunnelReport(input);
    expect(input.map((d) => d.tradeDate)).toEqual(snapshot);
  });
});
