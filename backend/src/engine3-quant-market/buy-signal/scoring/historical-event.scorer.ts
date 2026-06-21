/**
 * C4. 과거 유사 공시 성과 (HistoricalEventScore)
 *
 * EventStudyResult 기반 점수화 — Phase 9 미완료 시 0점 안전 처리.
 *
 * DAR-70: bucketKey 신호 정밀화. avgArD5 한 값만 쓰던 것을 확장해
 * EventStudyResult 가 이미 담고 있는 통계 신호를 종합한다.
 *   - isSignificant=false (p≥0.05): 통계적으로 무의미한 표본 → 강한 감쇠(과신 방지)
 *   - upProbD5: D+5 상승확률 가산/감점 (avgArD5 와 종합)
 *   - crashProbD5: D+5 급락확률 감점
 *   - sampleCount: 표본수 낮으면 신뢰 감쇠
 *
 * 후방호환: 확장 필드를 하나도 주지 않으면(= avgArD5 만 전달) 기존과 비트단위 동일한
 * 점수를 반환한다(회귀 0). 확장 필드가 하나라도 있을 때만 정밀화 로직이 작동한다.
 */

/** Event Study 집계가 유의성 판단에 쓰는 최소 표본 수 (event-study.service.MIN_SAMPLE_SIZE 와 동일) */
const MIN_SAMPLE_SIZE = 30;

/** PRELIMINARY(점진 반영) 하한 (event-study.service.PRELIMINARY_MIN_SAMPLE_SIZE 와 동일) */
const PRELIMINARY_MIN_SAMPLE_SIZE = 10;

export interface HistoricalEventInput {
  /** D+5 평균 초과수익 (%). Phase 9 미완료·결측 시 null → 0점 + 결측 처리 */
  avgArD5: number | null;

  /**
   * DAR-402: 이상치에 강건한 D+5 초과수익(winsorized 평균 우선, median 폴백).
   * 제공되면 baseScore 입력으로 avgArD5 대신 이 값을 쓴다(이상치 오염 차단).
   * 미제공(레거시 호출)이면 avgArD5 로 동작 — 회귀 0. 단, 결측 게이트는 여전히 avgArD5 로 판정해
   * "통계 산출 여부(데이터 가용성)"와 "강건 추정치"를 분리한다.
   */
  robustArD5?: number | null;

  // ── DAR-70 정밀화 신호 (모두 optional; 미제공 시 기존 동작 보존) ──
  /** p<0.05 통계적 유의성. false면 표본이 무의미 → 강한 감쇠 */
  isSignificant?: boolean;
  /** D+5 상승확률 (0~1) */
  upProbD5?: number;
  /** D+5 급락(-5% 이상) 확률 (0~1) */
  crashProbD5?: number;
  /** 집계 표본 수. 낮으면 신뢰 감쇠 */
  sampleCount?: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** avgArD5 기준 기본 점수 (기존 산식 — 불변) */
function baseScore(ar5: number): number {
  if (ar5 >= 10) return 100;
  if (ar5 >= 5) return 70;
  if (ar5 >= 2) return 40;
  if (ar5 >= 0) return 10;
  if (ar5 >= -3) return -30;
  return -70;
}

export function scoreHistoricalEvent(input: HistoricalEventInput): number {
  // 결측 게이트는 avgArD5(통계 가용성)로 판정 — 데이터가 없으면 강건 추정도 없다.
  if (input.avgArD5 == null) return 0;

  // DAR-402: baseScore 입력은 강건 추정치(robustArD5) 우선. 미제공 시 산술평균 폴백(회귀 0).
  const edge = input.robustArD5 != null ? input.robustArD5 : input.avgArD5;
  const base = baseScore(edge);

  // 확장 신호 미제공 → 기존 동작 그대로 (회귀 0)
  const hasEnrichment =
    input.isSignificant !== undefined ||
    input.upProbD5 !== undefined ||
    input.crashProbD5 !== undefined ||
    input.sampleCount !== undefined;
  if (!hasEnrichment) return base;

  // 1) 방향성 종합: avgArD5(base) + upProbD5 가산 + crashProbD5 감점
  let score = base;

  if (input.upProbD5 !== undefined) {
    const up = input.upProbD5;
    if (up >= 0.65) score += 15;
    else if (up >= 0.55) score += 7;
    else if (up < 0.4) score -= 15;
    else if (up < 0.5) score -= 7;
  }

  if (input.crashProbD5 !== undefined) {
    const crash = input.crashProbD5;
    if (crash >= 0.3) score -= 30;
    else if (crash >= 0.2) score -= 15;
    else if (crash >= 0.1) score -= 5;
  }

  // 2) 신뢰 감쇠 (과신 방지): 통계적 무의미·소표본일수록 종합점수를 0 쪽으로 축소
  let trust = 1;
  if (input.isSignificant === false) trust *= 0.2; // p≥0.05 → 강한 감쇠
  if (input.sampleCount !== undefined) {
    // DAR-324: 소표본 신뢰 감쇠를 단조 상승 램프로 교체(스냅 제거).
    //   n<10            → ×0.3 (순수 노이즈 — 로더가 INSUFFICIENT 로 미적재하나 직접호출 방어)
    //   10 ≤ n < 30     → 0.3→1.0 선형 단조 상승 (PRELIMINARY tier; n=29 ≈ 0.965 < 1)
    //   n ≥ 30          → 감쇠 없음(READY 불변·회귀 0)
    // 표본이 늘수록 감쇠가 약해져 영향이 정직하게 커지되, 항상 READY 미만에 머문다.
    const n = input.sampleCount;
    if (n < PRELIMINARY_MIN_SAMPLE_SIZE) {
      trust *= 0.3;
    } else if (n < MIN_SAMPLE_SIZE) {
      const ramp = (n - PRELIMINARY_MIN_SAMPLE_SIZE) / (MIN_SAMPLE_SIZE - PRELIMINARY_MIN_SAMPLE_SIZE);
      trust *= 0.3 + 0.7 * ramp;
    }
  }
  score *= trust;

  return clamp(Math.round(score), -100, 100);
}
