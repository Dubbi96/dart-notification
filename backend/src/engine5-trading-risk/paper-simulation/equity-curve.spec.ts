import { buildEquityCurve, withLivePoint } from './equity-curve';

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
      kind: 'snapshot',
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

  it('모든 점이 kind=snapshot(저장값 출처) 로 표기된다', () => {
    const out = buildEquityCurve(
      [
        { snapshotDate: '20260601', totalValue: 10_000_000 },
        { snapshotDate: '20260602', totalValue: 11_000_000 },
      ],
      INITIAL,
    );
    expect(out.every((p) => p.kind === 'snapshot')).toBe(true);
  });
});

describe('withLivePoint (DAR-393 헤더==곡선최신점 정합)', () => {
  const INITIAL = 10_000_000;
  // 이슈 실측 재현: 과거 스냅샷은 6/19 9,989,122.8(-0.11%, stale), 헤더 live 는 10,572,786.8(+5.73%).
  const STALE = buildEquityCurve(
    [{ snapshotDate: '20260619', totalValue: 9_989_122.8 }],
    INITIAL,
  );
  const LIVE_EQUITY = 10_572_786.8;

  it('★ 곡선 최신점 totalValue === 헤더 equity (±0) — 모순 해소', () => {
    const out = withLivePoint(STALE, '20260620', LIVE_EQUITY, INITIAL);
    const last = out[out.length - 1];
    expect(last.totalValue).toBe(LIVE_EQUITY);
    // 부호·% 일치: 헤더와 동일 초기원금 기준 등락률
    expect(last.returnPct).toBeCloseTo(5.727868, 4);
    expect(last.kind).toBe('live');
  });

  it('live 날짜 > 마지막 스냅샷일 → live 점을 append(과거 스냅샷 보존)', () => {
    const out = withLivePoint(STALE, '20260620', LIVE_EQUITY, INITIAL);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ snapshotDate: '20260619', kind: 'snapshot' });
    expect(out[1]).toMatchObject({ snapshotDate: '20260620', kind: 'live' });
  });

  it('live 날짜 === 마지막 스냅샷일 → 중복 날짜 없이 그 점을 live 값으로 교체', () => {
    const out = withLivePoint(STALE, '20260619', LIVE_EQUITY, INITIAL);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      snapshotDate: '20260619',
      totalValue: LIVE_EQUITY,
      returnPct: expect.any(Number),
      kind: 'live',
    });
  });

  it('스냅샷 0개 → live 점 1개만(정직)', () => {
    const out = withLivePoint([], '20260620', LIVE_EQUITY, INITIAL);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('live');
    expect(out[0].totalValue).toBe(LIVE_EQUITY);
  });

  it('live 날짜 < 마지막 스냅샷일(비정상) → 날짜 보존·값만 live 로 교체(곡선끝===헤더 불변식 유지)', () => {
    const future = buildEquityCurve(
      [{ snapshotDate: '20260625', totalValue: 9_000_000 }],
      INITIAL,
    );
    const out = withLivePoint(future, '20260620', LIVE_EQUITY, INITIAL);
    expect(out).toHaveLength(1);
    expect(out[0].snapshotDate).toBe('20260625');
    expect(out[0].totalValue).toBe(LIVE_EQUITY);
    expect(out[0].kind).toBe('live');
  });

  it('initialCapital ≤ 0 이면 live returnPct 0(0 나누기 방지)', () => {
    const out = withLivePoint([], '20260620', LIVE_EQUITY, 0);
    expect(out[0].returnPct).toBe(0);
  });
});
