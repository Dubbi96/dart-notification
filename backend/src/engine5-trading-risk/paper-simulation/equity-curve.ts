/**
 * 모의 자산곡선 빌더 — 순수 Rule (M10 모의운용 시각증명, DAR-60)
 *
 * PortfolioRiskSnapshot 의 일별 totalValue 를 초기 가상원금 기준 시계열로 변환한다.
 * 차트(모바일 svg 폴리라인)·졸업 진척 표시의 데이터 계약.
 *
 * ★ 정직 표기 원칙(DAR-39/40 계승): 스냅샷이 0개면 빈 배열, 1개면 점 1개만 — 추세를
 *   가공·보간하지 않는다(가짜 추세선 금지). 산술 변환만, AI 개입 0.
 */

/** 자산곡선 1점 — 일별 평가금액과 초기원금 대비 수익률 */
export interface EquityCurvePoint {
  /** 스냅샷일(YYYYMMDD) */
  snapshotDate: string;
  /** 일별 평가금액(원) */
  totalValue: number;
  /** 초기 가상원금 대비 누적 수익률(%) */
  returnPct: number;
  /**
   * 이 점의 가격 출처(DAR-393).
   * - 'snapshot' = 사이클 시점 저장값(과거·정체 가능). 일봉 백필 전 가격으로 굳을 수 있음.
   * - 'live'     = '지금'(오늘 KST) 실시간 실가로 재평가한 현재 점 = 헤더 평가금액과 동일 계산.
   */
  kind: 'snapshot' | 'live';
}

/** PortfolioRiskSnapshot 에서 필요한 최소 필드 */
export interface SnapshotRow {
  snapshotDate: string;
  totalValue: number;
}

/**
 * 스냅샷 행 → 자산곡선 점 배열.
 * - 입력은 snapshotDate 오름차순을 가정(호출부에서 정렬). 방어적으로 한 번 더 정렬한다.
 * - initialCapital ≤ 0 이면 returnPct 는 0 으로 안전 처리(0 나누기 방지).
 * - 빈 입력 → 빈 배열(점 0개). 1개 → 점 1개(가짜 추세선 금지).
 */
export function buildEquityCurve(
  snapshots: SnapshotRow[],
  initialCapital: number,
): EquityCurvePoint[] {
  const sorted = [...snapshots].sort((a, b) =>
    a.snapshotDate < b.snapshotDate ? -1 : a.snapshotDate > b.snapshotDate ? 1 : 0,
  );
  return sorted.map((s) => ({
    snapshotDate: s.snapshotDate,
    totalValue: s.totalValue,
    returnPct:
      initialCapital > 0
        ? ((s.totalValue - initialCapital) / initialCapital) * 100
        : 0,
    kind: 'snapshot' as const,
  }));
}

/**
 * 자산곡선 끝에 '현재(실시간)' 점을 정합 병합한다(DAR-393).
 *
 * 과거 스냅샷(사이클 시점·정체 가능)과 헤더 평가금액(live 실가 재평가)이 서로 다른 가격 시점을
 * 쓰면 곡선 끝 ≠ 헤더가 되어 모순으로 보인다(예: 헤더 +5.73% vs 곡선 -0.11%). 이를 없애기 위해
 * 곡선의 마지막 점이 **항상** 헤더와 동일한 live 평가금액을 가리키도록 정합한다.
 *
 * 불변식: 반환 곡선의 마지막 점 totalValue === liveEquity (헤더 평가금액과 ±0 일치).
 * - liveDate > 마지막 스냅샷일      → live 점을 append(오늘 신규 점).
 * - liveDate === 마지막 스냅샷일    → 그 점을 live 값으로 교체(중복 날짜 금지).
 * - liveDate < 마지막 스냅샷일(비정상·시계 이슈) → 마지막 점 날짜는 보존하되 값만 live 로 교체(정합 우선).
 * - 스냅샷 0개                       → live 점 1개.
 */
export function withLivePoint(
  points: EquityCurvePoint[],
  liveDate: string,
  liveEquity: number,
  initialCapital: number,
): EquityCurvePoint[] {
  const liveReturnPct =
    initialCapital > 0
      ? ((liveEquity - initialCapital) / initialCapital) * 100
      : 0;
  const livePoint: EquityCurvePoint = {
    snapshotDate: liveDate,
    totalValue: liveEquity,
    returnPct: liveReturnPct,
    kind: 'live',
  };
  if (points.length === 0) return [livePoint];
  const last = points[points.length - 1];
  if (liveDate > last.snapshotDate) return [...points, livePoint];
  if (liveDate === last.snapshotDate) return [...points.slice(0, -1), livePoint];
  // liveDate < last: 스냅샷이 미래 날짜(시계/주입 이상). 날짜는 보존하되 마지막 점을 live 값으로 교체해
  //   곡선 끝 === 헤더 불변식을 지킨다.
  return [...points.slice(0, -1), { ...livePoint, snapshotDate: last.snapshotDate }];
}
