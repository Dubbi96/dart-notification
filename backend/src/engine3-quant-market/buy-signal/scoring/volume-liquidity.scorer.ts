/**
 * C6. 거래량·수급 점수 (VolumeLiquidityScore)
 * 최소 유동성(거래대금 10억 미만) 강한 감점(-100). ※veto(차단)가 아님 —
 * 버킷 가중(~9%)으로 합산되므로 타 버킷이 높으면 양수 buyScore로 상쇄될 수 있다.
 * 실제 진입 차단은 entryCondition 유동성 게이트(다만 buyScore≥50 폴백 경로로 절대적이진 않음).
 * AI 금지영역: 순수 Rule 함수.
 */

export interface VolumeLiquidityInput {
  volume: number | null;       // 당일 거래량
  avgVolume20: number | null;  // 20일 평균 거래량
  tradingValue: number | null; // 당일 거래대금 (원)
  avgValue20: number | null;   // 20일 평균 거래대금
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function scoreVolumeLiquidity(input: VolumeLiquidityInput): number {
  // 필수 데이터 없으면 중립
  if (
    input.volume == null ||
    input.avgVolume20 == null ||
    input.tradingValue == null ||
    input.avgValue20 == null
  ) {
    return 0;
  }

  // 거래대금 최소 유동성 강한 감점 (10억 미만, -100). veto 아님 — 가중합산되어 상쇄 가능.
  if (input.tradingValue < 1_000_000_000) return -100;

  const volRatio =
    input.avgVolume20 > 0 ? input.volume / input.avgVolume20 : 0;
  let score = 0;

  if (volRatio >= 5)      score += 100;
  else if (volRatio >= 3) score += 70;
  else if (volRatio >= 2) score += 40;
  else if (volRatio >= 1) score += 10;
  else                    score -= 20;

  const tvRatio =
    input.avgValue20 > 0 ? input.tradingValue / input.avgValue20 : 1;
  if (tvRatio < 1) score -= 10;

  return clamp(score, -100, 100);
}
