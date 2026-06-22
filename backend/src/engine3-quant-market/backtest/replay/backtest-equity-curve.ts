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

/** YYYY-MM-DD 의 직전 달력일(YYYY-MM-DD). 월/연 경계 안전(UTC 산술). */
function dayBefore(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * 청산 거래 목록 → 자산곡선 (DAR-412: 일별 flat-fill).
 *
 * 첫 점은 초기자본(거래 전, date=startDate)으로 고정해 곡선 시작점을 명시한다.
 * 같은 날 복수 청산은 하나의 점으로 합산(누적)한다.
 *
 * **flat-fill 앵커**: 평가액이 변동하는 청산일마다 "그 직전 달력일"에
 * 변동 직전 평가액을 유지하는 앵커 점을 추가한다. 이렇게 하면 거래가 없던
 * 구간이 직선 보간으로 뭉개지지 않고 **평평(원금/직전 평가액 유지) → 청산 시점
 * 계단**으로 그려진다(모바일 EquityCurveChart 는 점을 인덱스 균등 간격으로 잇는다).
 * 앵커일이 직전 점의 날짜보다 엄격히 이후일 때만 추가(중복·역순 방지).
 *
 * lookahead 무관(사후 집계) — 이미 확정된 청산 결과만 사용한다.
 */
export function buildEquityCurve(
  trades: SimulatedTrade[],
  initialCapital: number,
  startDate: string,
): EquityCurvePoint[] {
  const closed = trades
    .filter((t) => t.exitDate && t.netPnl !== undefined)
    .sort((a, b) => a.exitDate!.getTime() - b.exitDate!.getTime());

  // 청산일(KST 거래일) 단위로 netPnl 합산 — 시간순 보존
  const byDay = new Map<string, number>();
  const order: string[] = [];
  for (const t of closed) {
    const key = toDateKey(t.exitDate!);
    if (!byDay.has(key)) {
      byDay.set(key, 0);
      order.push(key);
    }
    byDay.set(key, byDay.get(key)! + (t.netPnl ?? 0));
  }

  const curve: EquityCurvePoint[] = [
    { date: startDate, equity: initialCapital, returnPct: 0, drawdownPct: 0 },
  ];

  let equity = initialCapital;
  let peak = initialCapital;

  for (const key of order) {
    const prev = curve[curve.length - 1];

    // flat 앵커 — 변동 직전 평가액을 직전 달력일에 유지(평평 구간 보존).
    const anchorDate = dayBefore(key);
    if (anchorDate > prev.date) {
      curve.push({
        date: anchorDate,
        equity: prev.equity,
        returnPct: prev.returnPct,
        drawdownPct: prev.drawdownPct,
      });
    }

    equity += byDay.get(key)!;
    if (equity > peak) peak = equity;
    const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    const returnPct =
      initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0;

    const last = curve[curve.length - 1];
    if (key === last.date) {
      // 청산일이 직전 점(예: 시작일 당일 청산)과 동일 — 점 갱신(중복 생성 금지)
      last.equity = equity;
      last.returnPct = returnPct;
      last.drawdownPct = drawdownPct;
    } else {
      curve.push({ date: key, equity, returnPct, drawdownPct });
    }
  }

  return curve;
}
