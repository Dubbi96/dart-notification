// Exit Score Calculator — M8 (DAR-12)
// AI 금지영역: Exit Score·트리거·5액션은 순수 Rule. AI 개입 0.
// 판정 기준: 0~29: HOLD, 30~49: WATCH, 50~69: REDUCE, 70~89: EXIT, 90~100: BLOCK_REBUY(+EXIT)

import {
  ExitAction,
  ExitScoreComponents,
  ExitScoreResult,
  ExitTriggerType,
  PositionSnapshot,
  TechnicalSnapshot,
  ThesisSnapshot,
  DisclosureEvent,
} from './exit-engine.types';

export function scoreToAction(score: number): ExitAction {
  if (score >= 90) return 'BLOCK_REBUY';
  if (score >= 70) return 'EXIT';
  if (score >= 50) return 'REDUCE';
  if (score >= 30) return 'WATCH';
  return 'HOLD';
}

// Trigger 1: 손실 리스크 (lossRiskScore 0~20)
export function calcLossRiskScore(
  pos: PositionSnapshot,
  tech: TechnicalSnapshot,
): { score: number; triggered: boolean } {
  const currentPrice = tech.closePrice;
  const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

  // 하드 스탑
  if (pos.stopLossPct !== null && pnlPct <= -Math.abs(pos.stopLossPct)) {
    return { score: 20, triggered: true };
  }

  let score = 0;

  // ATR 기반 이탈
  if (tech.atr14 !== null) {
    const atrStop = pos.entryPrice - 1.5 * tech.atr14;
    if (currentPrice < atrStop) score += 15;
  }

  // 트레일링 스탑 (-6% from highest, 수익권에서만)
  if (pos.highestPrice !== null && pnlPct > 5) {
    const trailingStop = pos.highestPrice * (1 - 0.06);
    if (currentPrice < trailingStop) score += 12;
  }

  // 포트폴리오 전체 일일 손실 한도 초과
  if (
    pos.portfolioDailyLossPct !== null &&
    pos.portfolioDailyLossPct <= -pos.portfolioMaxDailyLossPct
  ) {
    score = Math.min(score + 10, 20);
  }

  return { score: Math.min(score, 20), triggered: score > 0 };
}

/**
 * 단일 invalidCondition 기계 평가 (DAR-74).
 *
 * AI 금지영역: 순수 Rule. position-thesis가 산출한 구조화 조건을 보유종목의
 * 시세/공시 실데이터(pos·tech·events)로 평가한다. pos·tech 가 없으면(직접 단위
 * 호출) 시세 기반 조건은 평가하지 않고, 테스트 픽스처의 명시적 `_triggered`
 * 플래그만 인정한다 — 기존 동작 보존.
 *
 * 결측 폴백: 평가에 필요한 시세 필드가 null 이면 그 조건은 미충족(false)으로
 * 보수 처리해 결측 데이터로 인한 오탐(false positive)을 막는다.
 */
export function evaluateInvalidCondition(
  cond: { type: string; [key: string]: unknown },
  eventTypes: Set<string>,
  pos: PositionSnapshot | null,
  tech: TechnicalSnapshot | null,
): boolean {
  // 테스트 픽스처/외부 평가가 명시적으로 표시한 충족 플래그를 항상 인정한다.
  if (cond['_triggered'] === true) return true;

  switch (cond.type) {
    case 'AMENDMENT_NEGATIVE':
      return (
        eventTypes.has('AMENDMENT_NEGATIVE') ||
        eventTypes.has('CONTRACT_CANCELLATION') ||
        eventTypes.has('PAID_IN_CAPITAL_INCREASE')
      );

    case 'PRICE_BELOW': {
      const value = cond['value'];
      if (!tech || typeof value !== 'number') return false;
      return tech.closePrice < value;
    }

    case 'PRICE_ABOVE': {
      const value = cond['value'];
      if (!tech || typeof value !== 'number') return false;
      return tech.closePrice > value;
    }

    case 'VOLUME_COLLAPSE': {
      const threshold = cond['threshold'];
      if (!tech || typeof threshold !== 'number' || tech.volumeRatio3d === null) {
        return false; // 결측 → 미충족(보수)
      }
      return tech.volumeRatio3d < threshold;
    }

    case 'EVENT_STUDY_UNDERPERFORM': {
      const threshold = cond['threshold'];
      // 현재 스냅샷은 D5 초과수익만 보유 → D5 지평만 평가, 그 외 결측 처리.
      if (
        !tech ||
        typeof threshold !== 'number' ||
        cond['horizon'] !== 'D5' ||
        tech.excessReturn5d === null
      ) {
        return false;
      }
      return tech.excessReturn5d < threshold;
    }

    case 'THESIS_METRIC_BREACH':
    case 'STOP_LOSS_PCT':
    case 'MAX_HOLD_DAYS':
      // STOP_LOSS_PCT·MAX_HOLD_DAYS 는 손실·시간 점수에서 별도 평가(이중계상 방지).
      // THESIS_METRIC_BREACH 는 스냅샷에 임의 지표가 없어 _triggered 외 미평가.
      return false;

    default:
      return false;
  }
}

// Trigger 3: 투자논리 훼손 (thesisBreakScore 0~20)
// AMENDMENT_NEGATIVE는 disclosure events로 체크. DAR-74: 시세 기반 구조화 조건
// (PRICE_*·VOLUME_COLLAPSE·EVENT_STUDY_UNDERPERFORM)은 pos·tech 실데이터로 평가.
export function calcThesisBreakScore(
  thesis: ThesisSnapshot | null,
  events: DisclosureEvent[],
  pos: PositionSnapshot | null = null,
  tech: TechnicalSnapshot | null = null,
): { score: number; triggered: boolean } {
  if (!thesis || thesis.invalidConditions.length === 0) {
    return { score: 0, triggered: false };
  }

  const eventTypes = new Set(events.map((e) => e.type));

  let triggeredCount = 0;
  let primaryTriggered = false;
  let isFirst = true;

  for (const cond of thesis.invalidConditions) {
    const hit = evaluateInvalidCondition(cond, eventTypes, pos, tech);
    if (hit) {
      triggeredCount++;
      if (isFirst) primaryTriggered = true;
    }
    isFirst = false;
  }

  let score = 0;
  if (triggeredCount >= 3) score = 20;
  else if (triggeredCount === 2) score = 14;
  else if (triggeredCount === 1) score = 8;

  if (primaryTriggered) score = Math.max(score, 16);

  return { score: Math.min(score, 20), triggered: triggeredCount > 0 };
}

// Trigger 4: 시간 초과 (timeExceededScore 0~10)
export function calcTimeExceededScore(
  pos: PositionSnapshot,
  thesis: ThesisSnapshot | null,
  tech: TechnicalSnapshot,
): { score: number; triggered: boolean } {
  const holdDays = tradingDaysSince(pos.entryDate);
  let score = 0;

  if (
    thesis?.maxHoldDays !== null &&
    thesis?.maxHoldDays !== undefined &&
    holdDays > thesis.maxHoldDays
  ) {
    score += 8;
  } else if (
    pos.maxHoldDays !== null &&
    pos.maxHoldDays !== undefined &&
    holdDays > pos.maxHoldDays
  ) {
    score += 8;
  }

  if (holdDays >= 5) {
    const excessReturn = tech.excessReturn5d ?? 0;
    if (excessReturn < 0) score += 4;
  }

  if (tech.avgVolumeRatio5d !== null && tech.avgVolumeRatio5d < 0.5) {
    score += 2;
  }

  return { score: Math.min(score, 10), triggered: score > 0 };
}

// Trigger 5: 차트 훼손 (chartBreakScore 0~20)
export function calcChartBreakScore(tech: TechnicalSnapshot): {
  score: number;
  triggered: boolean;
} {
  const close = tech.closePrice;
  let score = 0;

  if (tech.ma5 !== null && close < tech.ma5) score += 6;
  if (tech.ma20 !== null && close < tech.ma20) score += 10;
  if (tech.vwap !== null && close < tech.vwap) score += 4;
  if (tech.low20 !== null && close < tech.low20) score += 8;

  if (tech.openPrice !== null && tech.openPrice > 0) {
    const candleDropPct = ((close - tech.openPrice) / tech.openPrice) * 100;
    if (candleDropPct <= -3.0) score += 6;
  }

  return { score: Math.min(score, 20), triggered: score > 0 };
}

// Trigger 6: 리밸런싱 (overweightScore 0~10)
export function calcOverweightScore(pos: PositionSnapshot): {
  score: number;
  triggered: boolean;
} {
  if (pos.portfolioTotalValue <= 0) return { score: 0, triggered: false };
  const positionPct =
    ((pos.currentPrice * pos.quantity) / pos.portfolioTotalValue) * 100;
  let score = 0;

  if (positionPct > pos.portfolioMaxSinglePositionPct) {
    const excess = positionPct - pos.portfolioMaxSinglePositionPct;
    score += Math.min(Math.floor(excess / 2) * 2, 8);
  }

  return { score: Math.min(score, 10), triggered: score > 0 };
}

// 긍정 모멘텀 보너스 감산 (0~20)
export function calcPositiveMomentumBonus(tech: TechnicalSnapshot): number {
  let bonus = 0;

  const excessReturn5d = tech.excessReturn5d ?? 0;
  if (excessReturn5d > 5) bonus += 8;
  else if (excessReturn5d > 2) bonus += 4;

  if (tech.volumeRatio3d !== null && tech.volumeRatio3d > 1.5) bonus += 6;

  return Math.min(bonus, 20);
}

// 거래일 계산 (주말 제외 — 단순 근사)
export function tradingDaysSince(entryDate: Date): number {
  const now = new Date();
  const msPerDay = 86400000;
  const totalDays = Math.floor(
    (now.getTime() - entryDate.getTime()) / msPerDay,
  );
  // 주말 제외 근사: 7일 중 5거래일
  return Math.max(0, Math.floor(totalDays * (5 / 7)));
}

// 메인 계산 함수
export function calculateExitScore(
  pos: PositionSnapshot,
  tech: TechnicalSnapshot,
  thesis: ThesisSnapshot | null,
  disclosureEvents: DisclosureEvent[],
): ExitScoreResult {
  const lossResult = calcLossRiskScore(pos, tech);
  // DAR-74: 보유 포지션의 시세 실데이터(pos·tech)를 넘겨 구조화 invalidConditions를
  // 기계 평가한다(테제 훼손 시 THESIS_INVALIDATED 트리거 → 재평가/알림).
  const thesisResult = calcThesisBreakScore(thesis, disclosureEvents, pos, tech);
  const chartResult = calcChartBreakScore(tech);
  const timeResult = calcTimeExceededScore(pos, thesis, tech);
  const overweightResult = calcOverweightScore(pos);
  const momentumBonus = calcPositiveMomentumBonus(tech);

  // disclosure risk: if any negative disclosure triggered thesis — reuse proportionally
  const disclosureRiskScore =
    disclosureEvents.length > 0
      ? Math.min(disclosureEvents.length * 10, 20)
      : 0;

  const components: ExitScoreComponents = {
    lossRiskScore: lossResult.score,
    thesisBreakScore: thesisResult.score,
    chartBreakScore: chartResult.score,
    disclosureRiskScore,
    overweightScore: overweightResult.score,
    timeExceededScore: timeResult.score,
    positiveMomentumBonus: momentumBonus,
  };

  const rawScore =
    components.lossRiskScore +
    components.thesisBreakScore +
    components.chartBreakScore +
    components.disclosureRiskScore +
    components.overweightScore +
    components.timeExceededScore -
    components.positiveMomentumBonus;

  let exitScore = Math.max(0, Math.min(100, rawScore));

  // 하드 룰 오버라이드 (AI 금지 — 순수 Rule):
  // 하드 스탑로스(lossRiskScore=20)가 발동하면 최소 EXIT(70점) 보장
  if (lossResult.score === 20 && lossResult.triggered) {
    exitScore = Math.max(exitScore, 70);
  }

  // 투자논리 완전 훼손(thesisBreakScore=20)이면 최소 WATCH(30점) 보장
  if (thesisResult.score === 20 && thesisResult.triggered) {
    exitScore = Math.max(exitScore, 30);
  }

  const exitAction = scoreToAction(exitScore);

  const triggerTypes: ExitTriggerType[] = [];
  if (lossResult.triggered) triggerTypes.push('STOP_LOSS');
  if (thesisResult.triggered) triggerTypes.push('THESIS_INVALIDATED');
  if (chartResult.triggered) triggerTypes.push('CHART_BREAKDOWN');
  if (timeResult.triggered) triggerTypes.push('TIME_LIMIT');
  if (overweightResult.triggered) triggerTypes.push('REBALANCING');
  if (disclosureEvents.length > 0) triggerTypes.push('THESIS_INVALIDATED');

  // deduplicate
  const uniqueTriggers = [...new Set(triggerTypes)];

  return {
    components,
    exitScore,
    exitAction,
    triggerTypes: uniqueTriggers,
    primaryTrigger: uniqueTriggers[0] ?? null,
  };
}
