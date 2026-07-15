/**
 * 오늘의 브리핑(W14) — 순수 Rule 유틸.
 *
 * LLM $0 원칙: 브리핑의 모든 수치·문구는 룰 렌더링이다(신규 AI 호출 0 — 환각 0 자동 충족).
 * 이 파일은 브리핑 서비스가 위임하는 두 가지 순수 계산을 담는다:
 *   1) aggregateDailyPnl — PositionDailySnapshot 두 시점(최신·직전) 행으로 일간 손익 집계.
 *   2) extractSummaryLine — 캐시된 DisclosureAnalysis(summary task) resultJson에서 요약 1줄 추출.
 * 순수 함수(입력→출력 결정론)로 분리해 서비스의 조회·조립과 집계 산식의 검증 경계를 나눈다.
 */

/** PositionDailySnapshot에서 일간 손익 집계에 필요한 최소 행. */
export interface PnlSnapshotRow {
  positionId: string;
  /** 누적 미실현손익(진입가 대비, 스냅샷 시점 고정). */
  unrealizedPnl: number;
  /** 스냅샷 시점 평가금액. */
  positionValue: number;
}

export interface DailyPnlAggregate {
  /** 일간 손익(원) — Σ(최신 누적손익 − 직전 누적손익). 직전 스냅샷 없는 신규 포지션은 당일 진입분 전체. */
  dailyPnl: number;
  /**
   * 일간 손익률(%) — 분모는 전일 종가 기준 평가금액(= 최신 평가금액 − 일간 손익).
   * 분모 ≤ 0(데이터 이상)이면 null(0% 위장 금지 — 정직 결측).
   */
  dailyPnlPct: number | null;
  /** 최신 스냅샷 기준 집계 포지션 수. */
  positionCount: number;
}

/**
 * 일간 손익 집계 — 포지션별 (최신 누적손익 − 직전 누적손익)의 합.
 *
 * PositionDailySnapshot.unrealizedPnl은 진입가 대비 누적치이므로 두 시점 차분이 일간 손익이다.
 * 직전 스냅샷이 없는 포지션(당일 신규 진입)은 차감 0 → 당일 누적분 전체가 일간 손익으로 잡힌다(정확).
 * 직전에만 있고 최신에 없는 포지션(청산 등)은 최신 집계 모집단이 아니므로 제외한다.
 */
export function aggregateDailyPnl(
  latestRows: PnlSnapshotRow[],
  prevRows: PnlSnapshotRow[],
): DailyPnlAggregate {
  const prevPnlByPosition = new Map(prevRows.map((r) => [r.positionId, r.unrealizedPnl]));

  let dailyPnl = 0;
  let latestValue = 0;
  for (const row of latestRows) {
    dailyPnl += row.unrealizedPnl - (prevPnlByPosition.get(row.positionId) ?? 0);
    latestValue += row.positionValue;
  }

  const baseValue = latestValue - dailyPnl; // 전일 종가 기준 평가금액(역산)
  return {
    dailyPnl,
    dailyPnlPct: baseValue > 0 ? (dailyPnl / baseValue) * 100 : null,
    positionCount: latestRows.length,
  };
}

/** 요약 1줄 최대 길이 — 초과분은 말줄임(…)으로 절단(브리핑은 결합 표면, 상세는 공시 카드 딥링크). */
export const SUMMARY_LINE_MAX_LENGTH = 140;

/**
 * DisclosureAnalysis(summary task) resultJson → 요약 1줄.
 *
 * resultJson은 { summary: string, ... } 형태(engine2 SummaryTask OUTPUT_SCHEMA)지만
 * JSON 컬럼이라 방어적으로 파싱한다: 객체가 아니거나 summary가 비문자/공백이면 null(결측 정직).
 * 여러 줄이면 첫 줄만, 길면 SUMMARY_LINE_MAX_LENGTH 로 절단 — 신규 AI 호출 없이 캐시만 재사용.
 */
export function extractSummaryLine(resultJson: unknown): string | null {
  if (typeof resultJson !== 'object' || resultJson === null || Array.isArray(resultJson)) {
    return null;
  }
  const summary = (resultJson as Record<string, unknown>).summary;
  if (typeof summary !== 'string') return null;

  // 첫 '내용 있는' 줄 — 선행 빈 줄로 요약 전체가 유실되지 않게 한다.
  const firstLine =
    summary
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  if (firstLine.length === 0) return null;
  if (firstLine.length <= SUMMARY_LINE_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(0, SUMMARY_LINE_MAX_LENGTH - 1)}…`;
}
