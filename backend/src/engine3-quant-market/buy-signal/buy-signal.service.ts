/**
 * Buy Score 오케스트레이터 서비스 — M6-A (DAR-10)
 *
 * AI 금지영역: Buy Score 계산은 순수 Rule 기반. AI/LLM 개입 절대 금지.
 * 자동매수·주문 절대 금지 — 참고정보(TradingSignal 레코드) 생성만.
 *
 * 공식:
 *   Buy Score = Σ(Wi × Ci) − RiskPenalty
 *   clamp(-100, 100), 정수 반환
 */

import { Injectable } from '@nestjs/common';
import { BUY_SCORE_WEIGHTS, SIGNAL_GRADE_THRESHOLDS } from './config/buy-signal.config';
import {
  DisclosureEventInput,
  scoreDisclosureEvent,
} from './scoring/disclosure-event.scorer';
import { KeyMetricInput, scoreKeyMetric } from './scoring/key-metric.scorer';
import {
  PersonaFitInput,
  scorePersonaFit,
} from './scoring/persona-fit.scorer';
import {
  HistoricalEventInput,
  scoreHistoricalEvent,
} from './scoring/historical-event.scorer';
import { ChartInput, scoreChart } from './scoring/chart.scorer';
import {
  VolumeLiquidityInput,
  scoreVolumeLiquidity,
} from './scoring/volume-liquidity.scorer';
import {
  MarketSectorInput,
  scoreMarketSector,
} from './scoring/market-sector.scorer';
import {
  RiskPenaltyInput,
  scoreRiskPenalty,
} from './scoring/risk-penalty.scorer';
import { InsiderInput, scoreInsider } from './scoring/insider.scorer';
import {
  EntryConditionInput,
  evaluateEntryConditions,
} from './entry/entry-condition.evaluator';
import {
  BucketAvailability,
  BucketKey,
  detectBucketAvailability,
  renormalizeWeights,
} from './scoring/bucket-renormalization';

export type SignalGrade =
  | 'STRONG_BUY_CANDIDATE'
  | 'BUY_CANDIDATE'
  | 'WATCH'
  | 'NEUTRAL'
  | 'AVOID'
  | 'BLOCKED';

export interface ScoreBreakdown {
  disclosureEvent: number;
  keyMetric: number;
  personaFit: number;
  historicalEvent: number;
  chart: number;
  volumeLiquidity: number;
  marketSector: number;
  insider: number;
}

export interface BuyScoreParams {
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  persona: string;
  disclosureEvent: DisclosureEventInput;
  keyMetric: KeyMetricInput;
  personaFitInput: PersonaFitInput;
  historicalEvent: HistoricalEventInput;
  chart: ChartInput;
  volumeLiquidity: VolumeLiquidityInput;
  marketSector: MarketSectorInput;
  /** DAR-88: 내부자·대량보유 동향. 미주입 시 결측 처리(재정규화 제외 → 회귀 0). */
  insider?: InsiderInput;
  riskPenalty: RiskPenaltyInput;
  entryCondition: EntryConditionInput;
  subCategory?: string;
  signalSummary?: string;
  validUntil?: Date;
}

export interface BuySignalResult {
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  persona: string;
  eventType: string;
  subCategory?: string;
  buyScore: number;
  signal: SignalGrade;
  scoreBreakdown: ScoreBreakdown;
  riskPenalty: number;
  entryConditionMet: string[];
  entryConditionUnmet: string[];
  entryReady: boolean;
  riskFactors: string[];
  /** 버킷별 데이터 가용 여부 (DAR-49) — 후속 "미생성 사유 배지"(백로그#7)에서 활용 */
  dataAvailability: BucketAvailability;
  /** 결측으로 가중치 재정규화에서 제외된 버킷 목록 (DAR-49) */
  omittedBuckets: BucketKey[];
  signalSummary?: string;
  blockedReason?: string;
  validUntil?: Date;
  computedAt: Date;
}

export function mapScoreToGrade(score: number): SignalGrade {
  if (score >= SIGNAL_GRADE_THRESHOLDS.STRONG_BUY_CANDIDATE)
    return 'STRONG_BUY_CANDIDATE';
  if (score >= SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE) return 'BUY_CANDIDATE';
  if (score >= SIGNAL_GRADE_THRESHOLDS.WATCH) return 'WATCH';
  if (score >= SIGNAL_GRADE_THRESHOLDS.NEUTRAL) return 'NEUTRAL';
  return 'AVOID';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

@Injectable()
export class BuySignalService {
  computeBuyScore(params: BuyScoreParams): BuySignalResult {
    const penalty = scoreRiskPenalty(params.riskPenalty);

    // DAR-88: insider 미주입은 결측(빈 trades)으로 정규화.
    const insider: InsiderInput = params.insider ?? { trades: [] };

    // 결측 버킷 판별 (DAR-49) — BLOCKED 경로에서도 결과에 표기
    const availability = detectBucketAvailability({
      chart: params.chart,
      historicalEvent: params.historicalEvent,
      volumeLiquidity: params.volumeLiquidity,
      marketSector: params.marketSector,
      personaFit: params.personaFitInput,
      insider,
    });

    // 하드 차단 → BLOCKED 즉시 반환
    if (!isFinite(penalty)) {
      const entry = evaluateEntryConditions(params.entryCondition);
      return {
        rcpNo: params.rcpNo,
        corpCode: params.corpCode,
        stockCode: params.stockCode,
        persona: params.persona,
        eventType: params.disclosureEvent.eventType,
        subCategory: params.subCategory,
        buyScore: -100,
        signal: 'BLOCKED',
        scoreBreakdown: {
          disclosureEvent: 0,
          keyMetric: 0,
          personaFit: 0,
          historicalEvent: 0,
          chart: 0,
          volumeLiquidity: 0,
          marketSector: 0,
          insider: 0,
        },
        riskPenalty: 100,
        entryConditionMet: entry.met,
        entryConditionUnmet: entry.unmet,
        entryReady: false,
        riskFactors: ['매매 불가 종목 조건'],
        dataAvailability: availability,
        omittedBuckets: (Object.keys(availability) as BucketKey[]).filter(
          (k) => !availability[k],
        ),
        blockedReason: '거래정지·관리종목·투자주의·이상급등·차단 이벤트 타입',
        signalSummary: params.signalSummary,
        validUntil: params.validUntil,
        computedAt: new Date(),
      };
    }

    const W = BUY_SCORE_WEIGHTS;
    const breakdown: ScoreBreakdown = {
      disclosureEvent: scoreDisclosureEvent(params.disclosureEvent),
      keyMetric:       scoreKeyMetric(params.keyMetric),
      personaFit:      scorePersonaFit(params.personaFitInput),
      historicalEvent: scoreHistoricalEvent(params.historicalEvent),
      chart:           scoreChart(params.chart),
      volumeLiquidity: scoreVolumeLiquidity(params.volumeLiquidity),
      marketSector:    scoreMarketSector(params.marketSector),
      insider:         scoreInsider(insider),
    };

    // 결측 버킷 제외 후 가용 버킷 가중치를 합=1.0 으로 재정규화 (DAR-49).
    // 전버킷 가용 시 기존 가중치 그대로 → 산식 의미 비트단위 보존(회귀 0).
    const { effectiveWeights, omittedBuckets } = renormalizeWeights(
      { ...W },
      availability,
    );

    const weightedSum =
      effectiveWeights.disclosureEvent * breakdown.disclosureEvent +
      effectiveWeights.keyMetric       * breakdown.keyMetric +
      effectiveWeights.personaFit      * breakdown.personaFit +
      effectiveWeights.historicalEvent * breakdown.historicalEvent +
      effectiveWeights.chart           * breakdown.chart +
      effectiveWeights.volumeLiquidity * breakdown.volumeLiquidity +
      effectiveWeights.marketSector    * breakdown.marketSector +
      effectiveWeights.insider         * breakdown.insider;

    const buyScore = Math.round(clamp(weightedSum - penalty, -100, 100));
    const signal = mapScoreToGrade(buyScore);

    const entry = evaluateEntryConditions(params.entryCondition);

    const riskFactors: string[] = [];
    if (params.riskPenalty.isAmendment) riskFactors.push('정정공시');
    if ((params.riskPenalty.preDsclReturn ?? 0) > 10) riskFactors.push('선행급등');
    if (params.riskPenalty.avgDailyVolume != null && params.riskPenalty.avgDailyVolume < 100_000) {
      riskFactors.push('저유동성');
    }

    return {
      rcpNo: params.rcpNo,
      corpCode: params.corpCode,
      stockCode: params.stockCode,
      persona: params.persona,
      eventType: params.disclosureEvent.eventType,
      subCategory: params.subCategory,
      buyScore,
      signal,
      scoreBreakdown: breakdown,
      riskPenalty: penalty,
      entryConditionMet: entry.met,
      entryConditionUnmet: entry.unmet,
      entryReady: entry.entryReady,
      riskFactors,
      dataAvailability: availability,
      omittedBuckets,
      signalSummary: params.signalSummary,
      validUntil: params.validUntil,
      computedAt: new Date(),
    };
  }
}
