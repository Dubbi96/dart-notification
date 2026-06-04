/**
 * event-study.service.ts — Event Study 집계 서비스 (M5-A, DAR-9)
 *
 * 이벤트 스터디 계산 엔진:
 * - 개별 이벤트 관측치 AR 계산 (computeObservation)
 * - 버킷 단위 집계 (aggregate)
 * - 매수 점수 변환 (getEventStudyScore)
 */
import { Injectable } from '@nestjs/common';
import { mean, variance, tStatistic, tDistPValue } from './utils/statistics';
import { calcAR, PriceWindow, ARResult } from './utils/abnormal-return';

/** 통계적 유의성 판단을 위한 최소 표본 수 */
export const MIN_SAMPLE_SIZE = 30;

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
  status: 'READY' | 'INSUFFICIENT';
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
   * - n < MIN_SAMPLE_SIZE → status='INSUFFICIENT', 모든 수치 0
   * - n >= MIN_SAMPLE_SIZE → t-검정·AR·상승확률 등 계산
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

    // 표본 부족
    if (n < MIN_SAMPLE_SIZE) {
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

    // t-검정 (D+1 CAR 기준)
    const tStat = tStatistic(arD1s);
    const pVal = tDistPValue(tStat, n - 1);
    const varD1 = variance(arD1s);

    return {
      ...base,
      status: 'READY',
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
   * - INSUFFICIENT 또는 비유의: 0점
   * - avgArD5 기여: max 10, min -10
   * - upProbD5 기여: max 5, min -5
   * - crashProbD5 기여: max -5
   */
  getEventStudyScore(result: AggregatedResult | null): number {
    if (!result || !result.isSignificant || result.status === 'INSUFFICIENT') return 0;

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

    return Math.max(-20, Math.min(20, score));
  }
}
