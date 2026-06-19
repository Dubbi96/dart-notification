import { SimulatedTrade } from '../ports/backtest.types';

/**
 * 백테스트 트랙레코드 — 자산곡선(equity curve) 산출 (순수 함수)
 *
 * AI 금지영역: 순수 Rule 계산. AI 개입 0.
 *
 * 청산된 거래의 netPnl 을 청산일(exitDate) 순서로 누적해 초기자본 기준
 * 평가액 시계열을 만든다. 각 점에서 최고점 대비 낙폭(drawdownPct)도 동봉해
 * 앱의 트랙레코드 카드/곡선이 곧바로 그릴 수 있게 한다.
 *
 * lookahead 무관(사후 집계) — 이미 확정된 청산 결과만 사용한다.
 */
export interface EquityCurvePoint {
  /** 청산일 YYYY-MM-DD */
  date: string;
  /** 해당 시점 누적 평가액(초기자본 + 누적 netPnl) */
  equity: number;
  /** 초기자본 대비 누적 수익률 % */
  returnPct: number;
  /** 직전 최고점 대비 낙폭 % (0 이하, 최고점이면 0) */
  drawdownPct: number;
}

/** Date → YYYY-MM-DD (KST 거래일). UTC 자정 정준 표현을 그대로 사용 */
function toDateKey(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 청산 거래 목록 → 자산곡선.
 * 첫 점은 초기자본(거래 전, date='start')으로 고정해 곡선 시작점을 명시한다.
 * 같은 날 복수 청산은 하나의 점으로 합산(누적)한다.
 */
export function buildEquityCurve(
  trades: SimulatedTrade[],
  initialCapital: number,
  startDate: string,
): EquityCurvePoint[] {
  const closed = trades
    .filter((t) => t.exitDate && t.netPnl !== undefined)
    .sort((a, b) => (a.exitDate!.getTime() - b.exitDate!.getTime()));

  const curve: EquityCurvePoint[] = [
    { date: startDate, equity: initialCapital, returnPct: 0, drawdownPct: 0 },
  ];

  let equity = initialCapital;
  let peak = initialCapital;
  let lastKey: string | null = null;

  for (const t of closed) {
    equity += t.netPnl ?? 0;
    const key = toDateKey(t.exitDate!);
    if (equity > peak) peak = equity;
    const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    const returnPct =
      initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0;

    if (key === lastKey) {
      // 같은 날 추가 청산 — 마지막 점 갱신(중복 점 생성 금지)
      const last = curve[curve.length - 1];
      last.equity = equity;
      last.returnPct = returnPct;
      last.drawdownPct = drawdownPct;
    } else {
      curve.push({ date: key, equity, returnPct, drawdownPct });
      lastKey = key;
    }
  }

  return curve;
}
