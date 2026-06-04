/**
 * C7. 시장·업종 분위기 점수 (MarketSectorScore)
 * KOSPI/KOSDAQ 방향 + 업종 + VIX 기반
 * AI 금지영역: 순수 Rule 함수.
 */

export interface MarketSectorInput {
  kospiChange1d: number | null;   // KOSPI 전일 대비 변동률 (%)
  kosdaqChange1d: number | null;  // KOSDAQ 전일 대비 변동률 (%)
  sectorChange1d: number | null;  // 업종 지수 변동률 (%)
  vixEquivalent: number | null;   // VIX 상당값 (null 가능)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function scoreMarketSector(input: MarketSectorInput): number {
  // 모든 데이터 없으면 중립
  if (
    input.kospiChange1d == null &&
    input.kosdaqChange1d == null &&
    input.sectorChange1d == null
  ) {
    return 0;
  }

  let score = 0;

  // KOSPI 방향 (주 지표)
  const marketChange = input.kospiChange1d ?? input.kosdaqChange1d ?? 0;
  if (marketChange > 1.0)       score += 30;
  else if (marketChange > 0)    score += 10;
  else if (marketChange < -2.0) score -= 40;
  else if (marketChange < -1.0) score -= 20;

  // 업종 분위기
  if (input.sectorChange1d != null) {
    const sc = input.sectorChange1d;
    if (sc > 1.5)       score += 30;
    else if (sc > 0)    score += 10;
    else if (sc < -2.0) score -= 30;
  }

  // 공포지수/급락장 패널티
  if (input.vixEquivalent != null && input.vixEquivalent > 30) {
    score -= 30;
  }

  return clamp(score, -100, 100);
}
