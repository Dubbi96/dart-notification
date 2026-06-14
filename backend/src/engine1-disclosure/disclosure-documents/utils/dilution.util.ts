// backend/src/engine1-disclosure/disclosure-documents/utils/dilution.util.ts
// 희석률(dilutionRate) 단일 정의(SSOT) — DAR-246.
//
// 파이프라인 단계별로 서로 다른 공식이 존재해(매퍼=신주/(기존+신주), 추출기·서비스=신주/기존)
// 경로마다 다른 영속값이 생기던 문제를 한 함수로 통일한다.
// 다운스트림(engine3 dilutionPoints·risk-penalty)은 모두 "백분율(%)"을 가정하므로
// SSOT는 백분율 스케일로 고정한다.

/**
 * 희석률 SSOT.
 *
 * dilutionRate = newShares / (newShares + existingShares) * 100   (발행후 총주식 대비, %)
 *
 * - 발행후 총주식(기존+신주) 대비 신주 비율 = "진짜" 희석률.
 * - 소수점 2자리 반올림(%).
 * - 입력이 null/undefined, 기존주식 ≤ 0, 신주 < 0 이면 계산 불가로 null.
 *   (기존주식 ≤ 0 은 파싱 결손으로 간주 — 분모 결손 시 null 반환해 허위 100% 방지.)
 */
export function computeDilutionRate(
  newShares: number | null | undefined,
  existingShares: number | null | undefined,
): number | null {
  if (newShares == null || existingShares == null) return null;
  if (existingShares <= 0 || newShares < 0) return null;
  const total = newShares + existingShares;
  return Math.round((newShares / total) * 100 * 100) / 100;
}
