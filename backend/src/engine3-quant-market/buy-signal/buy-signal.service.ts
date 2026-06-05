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
import {
  EntryConditionInput,
  evaluateEntryConditions,
} from './entry/entry-condition.evaluator';

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
        },
        riskPenalty: 100,
        entryConditionMet: entry.met,
        entryConditionUnmet: entry.unmet,
        entryReady: false,
        riskFactors: ['매매 불가 종목 조건'],
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
    };

    const weightedSum =
      W.disclosureEvent * breakdown.disclosureEvent +
      W.keyMetric       * breakdown.keyMetric +
      W.personaFit      * breakdown.personaFit +
      W.historicalEvent * breakdown.historicalEvent +
      W.chart           * breakdown.chart +
      W.volumeLiquidity * breakdown.volumeLiquidity +
      W.marketSector    * breakdown.marketSector;

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
      signalSummary: params.signalSummary,
      validUntil: params.validUntil,
      computedAt: new Date(),
    };
  }
}
