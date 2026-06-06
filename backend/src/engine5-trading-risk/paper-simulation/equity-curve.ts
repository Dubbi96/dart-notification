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
  }));
}
