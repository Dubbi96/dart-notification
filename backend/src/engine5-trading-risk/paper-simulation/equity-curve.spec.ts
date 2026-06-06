import { buildEquityCurve } from './equity-curve';

describe('buildEquityCurve (DAR-60 모의 자산곡선)', () => {
  const INITIAL = 10_000_000;

  it('빈 스냅샷이면 빈 배열(점 0개 — 가짜 추세선 금지)', () => {
    expect(buildEquityCurve([], INITIAL)).toEqual([]);
  });

  it('스냅샷 1개면 점 1개만 반환(보간 금지)', () => {
    const out = buildEquityCurve(
      [{ snapshotDate: '20260601', totalValue: 10_500_000 }],
      INITIAL,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      snapshotDate: '20260601',
      totalValue: 10_500_000,
      returnPct: 5,
    });
  });

  it('초기원금 대비 누적 수익률(%)을 점마다 계산', () => {
    const out = buildEquityCurve(
      [
        { snapshotDate: '20260601', totalValue: 10_000_000 },
        { snapshotDate: '20260602', totalValue: 11_000_000 },
        { snapshotDate: '20260603', totalValue: 9_000_000 },
      ],
      INITIAL,
    );
    expect(out.map((p) => p.returnPct)).toEqual([0, 10, -10]);
  });

  it('입력 순서가 뒤섞여도 snapshotDate 오름차순으로 정렬', () => {
    const out = buildEquityCurve(
      [
        { snapshotDate: '20260603', totalValue: 9_000_000 },
        { snapshotDate: '20260601', totalValue: 10_000_000 },
        { snapshotDate: '20260602', totalValue: 11_000_000 },
      ],
      INITIAL,
    );
    expect(out.map((p) => p.snapshotDate)).toEqual([
      '20260601',
      '20260602',
      '20260603',
    ]);
  });

  it('initialCapital ≤ 0 이면 returnPct 0(0 나누기 방지)', () => {
    const out = buildEquityCurve(
      [{ snapshotDate: '20260601', totalValue: 5_000_000 }],
      0,
    );
    expect(out[0].returnPct).toBe(0);
  });

  it('원본 배열을 변형하지 않음(순수)', () => {
    const input = [
      { snapshotDate: '20260602', totalValue: 11_000_000 },
      { snapshotDate: '20260601', totalValue: 10_000_000 },
    ];
    const snapshot = JSON.stringify(input);
    buildEquityCurve(input, INITIAL);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
