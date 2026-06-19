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
  InsiderFlowSnapshot,
} from './exit-engine.types';

// ─── DAR-94: 이벤트 타입별 청산 무효화 가중 ──────────────────────────────
// engine1 고위험 5종(DAR-71 추출기) — 단건으로도 강한 청산 신호.
// 거래정지·상폐위험·감사의견 거절/한정·소송(횡령·배임)·공급계약 해제.
export const HIGH_RISK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'TRADING_SUSPENSION',
  'DELISTING_RISK',
  'AUDIT_OPINION_RISK',
  'LAWSUIT',
  'CONTRACT_CANCELLATION',
]);

// disclosureRisk 컴포넌트(0~20) 타입별 가중치
const HIGH_RISK_EVENT_WEIGHT = 16; // 고위험 5종: 단건 강한 가중
const GENERAL_EVENT_WEIGHT = 5; // 일반 악재: 약한 가중(다건 누적)
const INSIDER_NET_SELL_WEIGHT = 12; // 내부자/대량보유 대량 순매도
const DISCLOSURE_RISK_CAP = 20;

/**
 * 공시 악재 점수 소프트 캡 (DAR-349#5).
 *
 * 기존 `Math.min(raw, 20)` 하드 캡은 단건 고위험(16)+a 만 넘어도 모두 20으로
 * 평탄화되어 단일 위기와 다중 위기를 구분하지 못했다(비차별). 단건 고위험
 * 가중(16)까지는 선형으로 그대로 보존하고, 그 이상은 로그스케일형 감쇠로
 * 압축한다 — 초과분이 클수록 증가폭은 줄지만 **항상 단조 증가**하며 cap(20)에
 * 점근(도달하지 않음)한다. 결과적으로 다중 위기는 단일 위기보다 항상 높은 점수.
 */
export function softCapDisclosureRisk(raw: number): number {
  const linear = HIGH_RISK_EVENT_WEIGHT; // 16: 단건 고위험까지는 선형 보존
  if (raw <= linear) return raw;
  const headroom = DISCLOSURE_RISK_CAP - linear; // 4
  const compressed = headroom * (1 - Math.exp(-(raw - linear) / headroom));
  return linear + compressed;
}

// 내부자 '대량 순매도' 판정 임계(지분율 %p 환산 가중합)
const INSIDER_NET_SELL_THRESHOLD = 1.0;
// 규모 결측(ratioChange null) 시 보고 1건당 보수적 기본 규모(%p)
const INSIDER_MISSING_RATIO_SIZE = 0.5;

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

  // 트레일링 스탑 (-6% from highest) — DAR-349#1: 수익권 게이트(pnlPct>5) 제거.
  // 게이트가 있으면 +10%→-5% 하락처럼 고점 대비 급락했으나 진입가 대비 손실인
  // 구간에서 미발동(거짓음성)한다. 고점이 존재하면 손익 부호와 무관하게
  // current < peak*0.94 를 항상 평가해 고점 대비 6% 이상 하락을 포착한다.
  if (pos.highestPrice !== null) {
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
// DAR-349#3: 비중 계산 가격소스를 손절(calcLossRiskScore)과 동일한 tech.closePrice
// 로 통일한다. 기존엔 pos.currentPrice(stale 가능)를 써서 손절은 신선가, 비중은
// 구가로 평가해 모순 신호가 날 수 있었다.
export function calcOverweightScore(
  pos: PositionSnapshot,
  tech: TechnicalSnapshot,
): {
  score: number;
  triggered: boolean;
} {
  if (pos.portfolioTotalValue <= 0) return { score: 0, triggered: false };
  const positionPct =
    ((tech.closePrice * pos.quantity) / pos.portfolioTotalValue) * 100;
  let score = 0;

  if (positionPct > pos.portfolioMaxSinglePositionPct) {
    // DAR-349#6: floor(excess/2)*2 양자화 절벽 제거 — 초과분에 선형 비례(상한 8).
    // 1.4%↔1.5% 같은 미세 초과도 연속적으로 반영해 단조성을 보존한다.
    const excess = positionPct - pos.portfolioMaxSinglePositionPct;
    score += Math.min(excess, 8);
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

/**
 * 내부자/대량보유 '대량 순매도' 판정 (DAR-94, 순수 Rule).
 *
 * engine1 InsiderHoldingChange(DAR-87/88)를 최근 윈도우로 묶은 흐름에서
 * 매도 우위 + 유의 규모면 true. 보유종목 청산 무효화 신호로 사용.
 *  - 매도 규모 = SELL 보고의 |Δratio|(%p), 임원·주요주주 처분에 가중.
 *  - 매수는 순매도에서 차감(같은 윈도우 내 매수가 상쇄).
 *  - MIXED/UNKNOWN·결측 → 보수 처리(오탐 방지). 빈 목록 → false.
 *
 * AI 금지영역: 순수 Rule. AI/LLM 개입 0.
 */
export function isLargeInsiderNetSell(
  insider: InsiderFlowSnapshot | null,
): boolean {
  if (!insider || insider.trades.length === 0) return false;

  let netSellWeight = 0;
  for (const t of insider.trades) {
    const mag =
      t.ratioChange != null && Math.abs(t.ratioChange) > 0
        ? Math.abs(t.ratioChange)
        : INSIDER_MISSING_RATIO_SIZE;

    if (t.tradeType === 'SELL') {
      let w = mag;
      // DAR-349#4: 임원 가중(1.5)·주요주주 가중(1.5)을 곱셈으로 중복 적용하면
      // 둘 다 해당 시 2.25배가 되어 과대평가된다. 둘 다면 2.0, 어느 하나면 1.5.
      const isExecutive = t.source === 'EXECUTIVE';
      const isMajor = t.isMajorShareholder === true;
      if (isExecutive && isMajor) w *= 2.0;
      else if (isExecutive || isMajor) w *= 1.5;
      netSellWeight += w;
    } else if (t.tradeType === 'BUY') {
      netSellWeight -= mag; // 같은 윈도우 매수는 순매도 상쇄
    }
    // MIXED/UNKNOWN → 무시(보수)
  }

  return netSellWeight >= INSIDER_NET_SELL_THRESHOLD;
}

/**
 * 공시 악재 점수 (disclosureRiskScore 0~20) — DAR-94 타입별 가중.
 *
 * 기존 `events.length*10` 일괄 처리(타입 미구분)를 이벤트 타입별 가중으로
 * 정밀화한다. 고위험 5종은 강한 가중, 일반 악재는 약한 가중, 내부자/대량보유
 * 대량 순매도를 명시 invalid condition으로 결합.
 *
 * @returns severe — 고위험 5종 또는 대량 순매도 존재 여부(하드 플로어 판단용).
 */
export function calcDisclosureRiskScore(
  events: DisclosureEvent[],
  insider: InsiderFlowSnapshot | null = null,
): { score: number; triggered: boolean; severe: boolean } {
  let score = 0;
  let severe = false;

  for (const e of events) {
    if (HIGH_RISK_EVENT_TYPES.has(e.type)) {
      score += HIGH_RISK_EVENT_WEIGHT;
      severe = true;
    } else {
      score += GENERAL_EVENT_WEIGHT;
    }
  }

  if (isLargeInsiderNetSell(insider)) {
    score += INSIDER_NET_SELL_WEIGHT;
    severe = true;
  }

  return {
    // DAR-349#5: 하드 캡 대신 단조 소프트 캡으로 다중 위기 차별성 보존.
    score: softCapDisclosureRisk(score),
    triggered: score > 0,
    severe,
  };
}

/**
 * 두 시점 사이의 거래일(주말 제외) 정확 계산 — DAR-349#2 (순수 함수).
 *
 * 기존 `floor(totalDays*5/7)` 근사는 거래일을 약 20% 과소 추정해
 * maxHoldDays 초과 보유를 늦게 감지했다(예: 30일 → 근사 21, 실제 ~22).
 * from 다음 날부터 to(포함)까지 각 날의 요일을 세어 토·일을 제외한다.
 * 요일 판정은 TZ 비의존(getUTCDay)으로 결정론을 보장한다.
 */
export function countTradingDays(from: Date, to: Date): number {
  const msPerDay = 86400000;
  const totalDays = Math.floor((to.getTime() - from.getTime()) / msPerDay);
  if (totalDays <= 0) return 0;

  const fromDow = from.getUTCDay(); // 0=일 … 6=토
  let count = 0;
  for (let i = 1; i <= totalDays; i++) {
    const dow = (fromDow + i) % 7;
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// 진입 이후 경과 거래일(주말 제외 정확 계산).
export function tradingDaysSince(entryDate: Date): number {
  return countTradingDays(entryDate, new Date());
}

// 메인 계산 함수
export function calculateExitScore(
  pos: PositionSnapshot,
  tech: TechnicalSnapshot,
  thesis: ThesisSnapshot | null,
  disclosureEvents: DisclosureEvent[],
  insider: InsiderFlowSnapshot | null = null,
): ExitScoreResult {
  const lossResult = calcLossRiskScore(pos, tech);
  // DAR-74: 보유 포지션의 시세 실데이터(pos·tech)를 넘겨 구조화 invalidConditions를
  // 기계 평가한다(테제 훼손 시 THESIS_INVALIDATED 트리거 → 재평가/알림).
  const thesisResult = calcThesisBreakScore(thesis, disclosureEvents, pos, tech);
  const chartResult = calcChartBreakScore(tech);
  const timeResult = calcTimeExceededScore(pos, thesis, tech);
  const overweightResult = calcOverweightScore(pos, tech);
  const momentumBonus = calcPositiveMomentumBonus(tech);

  // DAR-94: 공시 악재를 이벤트 타입별로 가중(고위험 5종 강 / 일반 악재 약)하고,
  // 내부자/대량보유 대량 순매도를 invalid condition으로 결합한다.
  const disclosureResult = calcDisclosureRiskScore(disclosureEvents, insider);

  const components: ExitScoreComponents = {
    lossRiskScore: lossResult.score,
    thesisBreakScore: thesisResult.score,
    chartBreakScore: chartResult.score,
    disclosureRiskScore: disclosureResult.score,
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

  // DAR-94: 고위험 공시(거래정지·상폐위험·감사의견·소송·계약해지) 또는
  // 내부자/대량보유 대량 순매도 — 강한 무효화 신호. 긍정 모멘텀에 가려지지
  // 않도록 최소 WATCH(30점) 보장(권고 노출 보장 — 자동 실주문 아님, 안전3원칙).
  if (disclosureResult.severe) {
    exitScore = Math.max(exitScore, 30);
  }

  const exitAction = scoreToAction(exitScore);

  const triggerTypes: ExitTriggerType[] = [];
  if (lossResult.triggered) triggerTypes.push('STOP_LOSS');
  if (thesisResult.triggered) triggerTypes.push('THESIS_INVALIDATED');
  if (chartResult.triggered) triggerTypes.push('CHART_BREAKDOWN');
  if (timeResult.triggered) triggerTypes.push('TIME_LIMIT');
  if (overweightResult.triggered) triggerTypes.push('REBALANCING');
  // DAR-94: 타입별 가중 결과 triggered(악재 또는 대량 순매도)일 때만 무효화 트리거.
  if (disclosureResult.triggered) triggerTypes.push('THESIS_INVALIDATED');

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
