/**
 * event-study.service.ts — Event Study 집계 서비스 (M5-A, DAR-9)
 *
 * 이벤트 스터디 계산 엔진:
 * - 개별 이벤트 관측치 AR 계산 (computeObservation)
 * - 버킷 단위 집계 (aggregate)
 * - 매수 점수 변환 (getEventStudyScore)
 */
import { Injectable } from '@nestjs/common';
import { mean, median, winsorizedMean, variance, tStatistic, tDistPValue } from './utils/statistics';
import { calcAR, PriceWindow, ARResult } from './utils/abnormal-return';

/** READY(완전 반영) 게이트 — 통계적 유의성 판단을 위한 최소 표본 수 */
export const MIN_SAMPLE_SIZE = 30;

/**
 * PRELIMINARY(점진 반영) 하한 — 이 미만은 순수 노이즈로 보고 차단(INSUFFICIENT).
 * n ∈ [PRELIMINARY_MIN_SAMPLE_SIZE, MIN_SAMPLE_SIZE) 구간은 통계를 **실제로 계산**하되
 * status='PRELIMINARY' 로 표기하고, 스코어러가 강한 신뢰 감쇠를 적용한다(DAR-324).
 * 표본이 10→30 으로 늘며 영향이 0에서 단조적으로 커져 '풀가중 스냅'을 제거한다.
 */
export const PRELIMINARY_MIN_SAMPLE_SIZE = 10;

// ─── Input / Output 인터페이스 ────────────────────────────────────

export interface EventObservationInput {
  eventId: string;
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  eventType: string;
  bucketKey: string;
  d0Date: string;            // YYYYMMDD
  stockPrices: PriceWindow[]; // D-20~D+20 오름차순
  marketPrices: PriceWindow[]; // 동일 기간 시장 지수
  volumes?: PriceWindow[];
  baselineVolumes?: PriceWindow[];
}

export interface EventStudyAggregateInput {
  eventType: string;
  bucketKey: string;
  marketType: string;        // "KOSPI" | "KOSDAQ" | "ALL"
  observations: EventObservationInput[];
  dataFromDate: string;      // YYYYMMDD
  dataToDate: string;        // YYYYMMDD
}

export interface AggregatedResult {
  eventType: string;
  bucketKey: string;
  marketType: string;
  status: 'READY' | 'PRELIMINARY' | 'INSUFFICIENT';
  sampleCount: number;
  isSignificant: boolean;
  tStatistic: number | null;
  pValue: number | null;
  variance: number | null;
  avgReturnD1: number;
  avgReturnD3: number;
  avgReturnD5: number;
  avgReturnD20: number;
  avgArD1: number;
  avgArD3: number;
  avgArD5: number;
  avgArD20: number;
  // ── 강건(robust) 통계 (DAR-402) — 이상치 오염을 표면화·차단 ──
  /** D+5 누적 AR 중앙값. 산술평균(avgArD5)과 괴리가 크면 이상치 오염 신호. */
  medianArD5: number;
  /** D+20 누적 AR 중앙값. */
  medianArD20: number;
  /** D+5 누적 AR winsorized 평균(5%/95% clip). 신호 스코어링의 event edge 입력. */
  winsorizedMeanArD5: number;
  /** D+20 누적 AR winsorized 평균(5%/95% clip). */
  winsorizedMeanArD20: number;
  upProbD5: number;
  crashProbD5: number;
  avgMaxDrawdown: number;
  avgVolumeRatioD1: number;
  avgVolumeRatioD3: number;
  dataFromDate: string;
  dataToDate: string;
}

// ─── 서비스 ──────────────────────────────────────────────────────

@Injectable()
export class EventStudyService {
  /**
   * 단일 이벤트 관측치에 대한 AR 결과를 계산한다.
   */
  computeObservation(input: EventObservationInput): ARResult {
    return calcAR(
      input.stockPrices,
      input.marketPrices,
      input.d0Date,
      input.volumes,
      input.baselineVolumes,
    );
  }

  /**
   * 다수 이벤트 관측치를 집계하여 버킷 단위 통계를 생성한다.
   *
   * - n < PRELIMINARY_MIN_SAMPLE_SIZE → status='INSUFFICIENT', 모든 수치 0 (순수 노이즈 차단)
   * - PRELIMINARY_MIN_SAMPLE_SIZE ≤ n < MIN_SAMPLE_SIZE → 통계 실제 계산 + status='PRELIMINARY'
   *   (소표본이라 isSignificant 는 대개 false; 스코어러가 신뢰 감쇠로 과신 방지)
   * - n >= MIN_SAMPLE_SIZE → t-검정·AR·상승확률 등 계산, status='READY'
   */
  aggregate(input: EventStudyAggregateInput): AggregatedResult {
    const { eventType, bucketKey, marketType, observations, dataFromDate, dataToDate } = input;
    const n = observations.length;

    const base = {
      eventType,
      bucketKey,
      marketType,
      sampleCount: n,
      dataFromDate,
      dataToDate,
    };

    // 표본 부족(순수 노이즈) — 통계 미계산, 모든 수치 0
    if (n < PRELIMINARY_MIN_SAMPLE_SIZE) {
      return {
        ...base,
        status: 'INSUFFICIENT',
        isSignificant: false,
        tStatistic: null,
        pValue: null,
        variance: null,
        avgReturnD1: 0,
        avgReturnD3: 0,
        avgReturnD5: 0,
        avgReturnD20: 0,
        avgArD1: 0,
        avgArD3: 0,
        avgArD5: 0,
        avgArD20: 0,
        medianArD5: 0,
        medianArD20: 0,
        winsorizedMeanArD5: 0,
        winsorizedMeanArD20: 0,
        upProbD5: 0,
        crashProbD5: 0,
        avgMaxDrawdown: 0,
        avgVolumeRatioD1: 1,
        avgVolumeRatioD3: 1,
      };
    }

    // 모든 관측치 AR 계산
    const ars: ARResult[] = observations.map(o => this.computeObservation(o));

    // D+N 누적 AR
    const arD1s = ars.map(a => a.cumulativeAR['d1'] ?? 0);
    const arD3s = ars.map(a => a.cumulativeAR['d3'] ?? 0);
    const arD5s = ars.map(a => a.cumulativeAR['d5'] ?? 0);
    const arD20s = ars.map(a => a.cumulativeAR['d20'] ?? 0);

    // t-검정 (D+1 CAR 기준) — 지평 의도 (DAR-221)
    // isSignificant 는 "D+1 즉각반응(announcement effect) 이 통계적으로 존재하는가"를
    // 검정하여 **버킷 신뢰도 게이트**로 쓴다. 점수(getEventStudyScore)는 D+5 누적
    // (avgArD5·upProbD5)을 쓰므로 게이트 지평(D+1)과 점수 지평(D+5)이 다르다.
    // 이는 의도된 설계다(docs/roadmap/phase-09-event-study.md §4-4 aggregateBucket):
    //   - D+1 즉각반응은 이후 무관한 뉴스에 가장 덜 오염되어 "이 이벤트 유형이
    //     시장을 실제로 움직이는가(신호 vs 노이즈)"를 가장 깨끗하게 판별한다.
    //   - D+5 누적은 드리프트의 크기·방향(점수 본체)을 담는다.
    // 알려진 트레이드오프: D+1 무유의·D+5 유의 버킷은 0점 게이트되고, 반대로
    // D+1만 유의한 노이즈가 통과할 수 있다. D+5 게이트(tStatistic(arD5s))로의 정렬은
    // announcement-effect 의미를 잃으므로 채택하지 않았다.
    //
    // ★ DAR-402 — "avgArD20 양수인데 tStatistic 음수" 부호 불일치 규명:
    //   두 수치는 **서로 다른 측정**이다 — tStatistic 은 D+1 CAR(arD1s) 기준, avgArD20 은
    //   D+20 CAR 의 산술평균이다. 따라서 부호가 갈리는 것은 버그가 아니라 두 원인의 복합이다:
    //     (a) 다른 지평/필드: t 는 D+1 즉각반응 방향, avgArD20 은 D+20 누적 크기.
    //     (b) 산술평균의 이상치 지배: 유동성 낮은 KOSDAQ 소형주 폭등이 avgArD20 평균을
    //         +로 끌어올리지만, 중앙값(medianArD20)·winsorized 평균은 음수로 남는다.
    //   robust 통계(아래 median/winsorized)를 함께 영속해 (b)를 표면화하고, 신호 스코어가
    //   산술평균 대신 winsorized 평균을 event edge 로 쓰도록 전환한다(historical-event.scorer).
    const tStat = tStatistic(arD1s);
    const pVal = tDistPValue(tStat, n - 1);
    const varD1 = variance(arD1s);

    // n>=30 → READY(완전 반영), 10≤n<30 → PRELIMINARY(점진 반영·감쇠).
    // 어느 tier든 통계는 동일하게 실제 계산한다(0으로 만들지 않음).
    return {
      ...base,
      status: n >= MIN_SAMPLE_SIZE ? 'READY' : 'PRELIMINARY',
      isSignificant: pVal < 0.05,
      tStatistic: tStat,
      pValue: pVal,
      variance: varD1,

      // 종목 수익률 (D+N 단순 또는 누적)
      avgReturnD1: mean(ars.map(a => a.dailyReturns['d1'] ?? 0)),
      avgReturnD3: mean(ars.map(a => a.cumulativeAR['d3'] ?? 0)),
      avgReturnD5: mean(ars.map(a => a.cumulativeAR['d5'] ?? 0)),
      avgReturnD20: mean(ars.map(a => a.cumulativeAR['d20'] ?? 0)),

      // 초과수익
      avgArD1: mean(arD1s),
      avgArD3: mean(arD3s),
      avgArD5: mean(arD5s),
      avgArD20: mean(arD20s),

      // 강건(robust) 통계 (DAR-402) — 동일 표본(arD5s/arD20s)에서 중앙값·winsorized 평균.
      medianArD5: median(arD5s),
      medianArD20: median(arD20s),
      winsorizedMeanArD5: winsorizedMean(arD5s),
      winsorizedMeanArD20: winsorizedMean(arD20s),

      // 분포 지표
      upProbD5: ars.filter(a => a.isUpD5).length / n,
      crashProbD5: ars.filter(a => a.isCrashD5).length / n,
      avgMaxDrawdown: mean(ars.map(a => a.maxDrawdown)),

      // 거래량
      avgVolumeRatioD1: mean(ars.map(a => a.volumeRatios['d1'] ?? 1)),
      avgVolumeRatioD3: mean(ars.map(a => a.volumeRatios['d3'] ?? 1)),
    };
  }

  /**
   * Event Study 결과를 매수 점수 (-20 ~ +20)로 변환한다.
   * Phase 6 연결용 인터페이스.
   *
   * - INSUFFICIENT(n<10): 0점 (순수 노이즈 차단)
   * - READY 비유의: 0점 (D+1 유의성 게이트 — 불변)
   * - PRELIMINARY(n∈[10,30)): D+5 점수를 실제 계산하되 신뢰 감쇠 적용(과신 방지·DAR-324)
   * - avgArD5 기여: max 10, min -10
   * - upProbD5 기여: max 5, min -5
   * - crashProbD5 기여: max -5
   */
  getEventStudyScore(result: AggregatedResult | null): number {
    // 게이트=D+1 유의성(즉각반응 신뢰도), 점수=D+5 누적 — 지평 불일치는 의도된 설계.
    // 상세 근거는 aggregate() 의 t-검정 주석(DAR-221) 참조.
    if (!result || result.status === 'INSUFFICIENT') return 0;
    // READY 경로 비유의 게이트는 불변(회귀 0): D+1 유의성 없으면 0점.
    if (result.status === 'READY' && !result.isSignificant) return 0;

    let score = 0;

    // avgArD5 기준 점수
    if (result.avgArD5 >= 5) score += 10;
    else if (result.avgArD5 >= 2) score += 5;
    else if (result.avgArD5 >= 0) score += 2;
    else if (result.avgArD5 < -5) score -= 10;
    else if (result.avgArD5 < -2) score -= 5;

    // upProbD5 기준 점수
    if (result.upProbD5 >= 0.65) score += 5;
    else if (result.upProbD5 >= 0.55) score += 2;
    else if (result.upProbD5 < 0.40) score -= 5;

    // 급락 확률 패널티
    if (result.crashProbD5 >= 0.20) score -= 5;

    score = Math.max(-20, Math.min(20, score));

    // PRELIMINARY(소표본): 신뢰 감쇠로 과신 방지 — 표본이 클수록 단조 상승하되
    // 항상 READY(완전 반영) 미만에 머문다(스냅 제거·인플레이션 방지).
    if (result.status === 'PRELIMINARY') {
      score *= preliminaryTrust(result.isSignificant, result.sampleCount);
    }

    return score;
  }
}

/**
 * PRELIMINARY tier 신뢰 감쇠 계수 (0~1, DAR-324).
 *
 *  - isSignificant=false → ×0.2 (통계적 무의미 — 강한 감쇠, 과신 방지)
 *  - sampleCount: 10→30 으로 늘며 0.3→1.0 선형 단조 상승. n<30 이므로 항상 <1
 *    (n=29 ≈ 0.965) → READY(계수 1.0)보다 항상 작다.
 *
 * historical-event.scorer 의 신뢰 감쇠와 동일한 형태(SSOT 의도)로 맞춰
 * 두 스코어링 경로의 점진성·상한 보장이 일치하도록 한다.
 */
export function preliminaryTrust(isSignificant: boolean, sampleCount: number): number {
  const sig = isSignificant ? 1 : 0.2;
  const span = MIN_SAMPLE_SIZE - PRELIMINARY_MIN_SAMPLE_SIZE; // 20
  const ramp = (sampleCount - PRELIMINARY_MIN_SAMPLE_SIZE) / span; // n=10→0, n=30→1
  const sampleTrust = 0.3 + 0.7 * Math.max(0, Math.min(1, ramp)); // [0.3, 1.0)
  return sig * sampleTrust;
}
