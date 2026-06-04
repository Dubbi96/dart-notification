/**
 * statistics.ts — 순수 수학 함수 모음 (NestJS 의존 없음)
 * Event Study 통계 계산용 (M5-A, DAR-9)
 */

/**
 * 산술 평균
 */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sum = arr.reduce((acc, v) => acc + v, 0);
  return sum / arr.length;
}

/**
 * 표본 분산 (sample variance)
 * @param arr 입력 배열
 * @param ddof degrees of freedom (기본값 1 = 표본 분산)
 */
export function variance(arr: number[], ddof = 1): number {
  if (arr.length <= ddof) return 0;
  const m = mean(arr);
  const sumSq = arr.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return sumSq / (arr.length - ddof);
}

/**
 * 표본 표준편차 (sample standard deviation)
 * @param arr 입력 배열
 * @param ddof degrees of freedom (기본값 1 = 표본 표준편차)
 */
export function stdDev(arr: number[], ddof = 1): number {
  return Math.sqrt(variance(arr, ddof));
}

/**
 * t-통계량 계산
 * t = mean / (stdDev / sqrt(n))
 */
export function tStatistic(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  const m = mean(arr);
  const s = stdDev(arr);
  if (s === 0) {
    // 모든 값이 동일한 경우: t → ±Infinity (방향만 유지)
    return m === 0 ? 0 : m > 0 ? Infinity : -Infinity;
  }
  return m / (s / Math.sqrt(n));
}

/**
 * 표준 정규 누적 분포 함수 (CDF)
 * Abramowitz & Stegun 26.2.17 근사
 */
function normalCDF(z: number): number {
  const p = 0.2316419;
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const t = 1 / (1 + p * Math.abs(z));
  const poly = t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

/**
 * t-분포 양측 p-값 (정규분포 근사)
 * 대표본(n≥30)에서 허용 가능한 근사이며 Fixture 테스트 목적으로 충분함
 *
 * @param t t-통계량
 * @param df 자유도 (n-1)
 */
export function tDistPValue(t: number, df: number): number {
  void df; // 정규 근사에서는 df 미사용 (대표본 가정)
  if (!isFinite(t)) return 0; // |t| = Infinity → p ≈ 0
  return 2 * (1 - normalCDF(Math.abs(t)));
}
