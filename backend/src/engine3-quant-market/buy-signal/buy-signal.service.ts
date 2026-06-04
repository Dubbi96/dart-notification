import { Injectable } from '@nestjs/common';
import type { TechnicalIndicator } from '../indicators/technical-indicator.service';
import type { EventStudyResult } from '../event-study/event-study.service';

export interface BuyScoreParams {
  stockCode: string;
  eventType: string;
  keyMetrics: Record<string, number | string | null>;
  indicator: TechnicalIndicator;
  studyResult: EventStudyResult | null;
  userPersona?: string;
}

export interface TradingSignal {
  stockCode: string;
  score: number;
  breakdown: {
    base: number;
    numeric: number;
    persona: number;
    history: number;
    chart: number;
    market: number;
    penalty: number;
  };
  computedAt: Date;
}

/**
 * 매수신호 서비스 — M4 스켈레톤.
 *
 * AI 금지영역: 점수 공식은 순수 Rule 기반. AI 개입 절대 금지.
 *
 * 점수 공식(cc-engine-architecture §4-5):
 *   base + numeric + persona + history + chart + market - penalty
 *   clamp(-100, 100)
 *
 * TODO(M6): 각 세부 계산 함수 구현.
 */
@Injectable()
export class BuySignalService {
  computeBuyScore(params: BuyScoreParams): TradingSignal {
    const breakdown = {
      base: this.scoreBase(params.eventType),
      numeric: this.scoreNumericFields(params.keyMetrics),
      persona: this.scorePersonaFit(params.userPersona),
      history: this.scoreHistory(params.studyResult),
      chart: this.scoreChart(params.indicator),
      market: this.scoreMarketSentiment(),
      penalty: this.scorePenalty(params.eventType, params.indicator),
    };

    const raw =
      breakdown.base +
      breakdown.numeric +
      breakdown.persona +
      breakdown.history +
      breakdown.chart +
      breakdown.market -
      breakdown.penalty;

    return {
      stockCode: params.stockCode,
      score: Math.max(-100, Math.min(100, raw)),
      breakdown,
      computedAt: new Date(),
    };
  }

  private scoreBase(_eventType: string): number {
    // TODO(M6): EVENT_SCORE_TABLE[eventType]
    return 0;
  }

  private scoreNumericFields(
    _keyMetrics: Record<string, number | string | null>,
  ): number {
    // TODO(M6): 계약금액/희석률 등 수치 점수
    return 0;
  }

  private scorePersonaFit(_userPersona?: string): number {
    // TODO(M6): 페르소나 적합도
    return 0;
  }

  private scoreHistory(studyResult: EventStudyResult | null): number {
    // 과거 D+5 평균 반응 × 10
    return studyResult?.d5AvgReturn != null
      ? studyResult.d5AvgReturn * 10
      : 0;
  }

  private scoreChart(_indicator: TechnicalIndicator): number {
    // TODO(M6): MA 위치, 거래량
    return 0;
  }

  private scoreMarketSentiment(): number {
    // TODO(M6): KOSPI/KOSDAQ 상태
    return 0;
  }

  private scorePenalty(
    _eventType: string,
    _indicator: TechnicalIndicator,
  ): number {
    // TODO(M6): 관리종목/급등/희석 등
    return 0;
  }
}
