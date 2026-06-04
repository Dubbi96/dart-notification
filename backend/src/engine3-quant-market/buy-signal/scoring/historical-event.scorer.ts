/**
 * C4. 과거 유사 공시 성과 (HistoricalEventScore)
 * EventStudyResult.avgArD5 기반 점수화 — Phase 9 미완료 시 0점 안전 처리
 */

export interface HistoricalEventInput {
  avgArD5: number | null; // D+5 평균 초과수익 (%), Phase 9 미완료 시 null
}

export function scoreHistoricalEvent(input: HistoricalEventInput): number {
  if (input.avgArD5 == null) return 0;

  const ar5 = input.avgArD5;
  if (ar5 >= 10) return 100;
  if (ar5 >= 5)  return 70;
  if (ar5 >= 2)  return 40;
  if (ar5 >= 0)  return 10;
  if (ar5 >= -3) return -30;
  return -70;
}
