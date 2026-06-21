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
 * 중앙값 (median) — DAR-402.
 *
 * 산술평균(mean)이 극단 이상치(유동성 낮은 KOSDAQ 소형주의 폭등/폭락)에 지배되는 것을
 * 막기 위한 강건(robust) 통계. 짝수 길이는 가운데 두 값의 평균.
 * 빈 배열은 mean 과 동일하게 0 을 반환(집계 컬럼이 NaN 으로 새지 않도록).
 */
export function median(arr: number[]): number {
  const n = arr.length;
  if (n === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 분위수 (percentile) — DAR-402. 선형 보간(R-7, numpy 기본과 동일).
 *
 * @param arr 입력 배열
 * @param p   0~1 (0.05 = 5번째 백분위, 0.95 = 95번째 백분위)
 */
export function percentile(arr: number[], p: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  if (n === 1) return arr[0];
  const sorted = [...arr].sort((a, b) => a - b);
  const clampP = Math.max(0, Math.min(1, p));
  const idx = clampP * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * winsorized 평균 (winsorized mean) — DAR-402.
 *
 * [lowerP, upperP] 백분위 경계 밖의 값을 경계값으로 **치환(clip)** 한 뒤 산술평균을 낸다.
 * 표본 크기는 보존하면서(trimmed 와 달리 제거하지 않음) 극단 이상치의 영향만 캡한다.
 * 기본 5%/95% — 양 꼬리 각 5% 의 극단치를 5/95 분위값으로 누른다.
 *
 * 산술평균과의 괴리가 클수록 그 버킷의 평균이 소수 이상치에 오염됐다는 신호다
 * (예: SUPPLY_CONTRACT avgArD20=+24.91% 인데 winsorized/median 은 음수).
 *
 * @param arr    입력 배열
 * @param lowerP 하단 클립 분위 (기본 0.05)
 * @param upperP 상단 클립 분위 (기본 0.95)
 */
export function winsorizedMean(arr: number[], lowerP = 0.05, upperP = 0.95): number {
  const n = arr.length;
  if (n === 0) return 0;
  const lo = percentile(arr, lowerP);
  const hi = percentile(arr, upperP);
  const clipped = arr.map(v => (v < lo ? lo : v > hi ? hi : v));
  return mean(clipped);
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
