import type { EntryCondition, RiskFlag, TradingSignal } from '@app-types/signal.types';

import { getEventTypeLabel } from './disclosureType';
import { gradeLabel } from './signalDisplay';

/**
 * 일일 에디션을 "공시/회사 카드 모음"이 아니라
 * 종합 의견 → 종목별 판단 → 실행 조건 순으로 읽게 만드는 순수 표시 모델.
 *
 * 매수점수·진입조건·리스크를 재계산하지 않고 서버가 내려준 사실만 조합한다.
 * 단기 시나리오는 정본 전략룰북의 short-momentum(점수≥40, NEXT_OPEN,
 * +10%/-5%, 최대 5거래일)을 설명할 뿐 주문이나 개인화 추천을 만들지 않는다.
 */

export const SHORT_MOMENTUM_RULE = {
  minBuyScore: 40,
  takeProfitPct: 10,
  stopLossPct: -5,
  maxHoldDays: 5,
} as const;

export type EditionDecisionTone = 'ready' | 'mixed' | 'wait';
export type SignalPlanTone = 'ready' | 'check' | 'risk' | 'review';

export interface EditionDecisionModel {
  tone: EditionDecisionTone;
  eyebrow: string;
  headline: string;
  description: string;
  readyCount: number;
  checkCount: number;
  riskCount: number;
  topPriority: string;
}

export interface EditionSignalPlan {
  tone: SignalPlanTone;
  verdict: string;
  rationale: string;
  eventLabel: string;
  metConditions: EntryCondition[];
  unmetConditions: EntryCondition[];
  riskFlags: RiskFlag[];
  entryGuide: string;
  invalidationGuide: string;
  hasShortMomentumScenario: boolean;
}

function requiredConditions(signal: TradingSignal): EntryCondition[] {
  return signal.entryConditions.filter((condition) => condition.required);
}

export function isEntryReadyForEdition(signal: TradingSignal): boolean {
  const required = requiredConditions(signal);
  return required.length > 0 && required.every((condition) => condition.met);
}

export function buildEditionSignalPlan(signal: TradingSignal): EditionSignalPlan {
  const required = requiredConditions(signal);
  const metConditions = required.filter((condition) => condition.met);
  const unmetConditions = required.filter((condition) => !condition.met);
  const riskFlags = signal.riskFlags;
  const hasRisk = riskFlags.length > 0;
  const ready = isEntryReadyForEdition(signal);

  let tone: SignalPlanTone;
  let verdict: string;

  if (hasRisk) {
    tone = 'risk';
    verdict = '리스크 확인 전 대기';
  } else if (unmetConditions.length > 0) {
    tone = 'check';
    verdict = '조건 확인 전 대기';
  } else if (ready) {
    tone = 'ready';
    verdict = '조건부 진입 검토';
  } else {
    tone = 'review';
    verdict = '근거 상세 확인';
  }

  const rationale =
    signal.summary ??
    `${getEventTypeLabel(signal.eventType ?? 'OTHER')} 및 매수점수 ${signal.buyScore}점(${gradeLabel(
      signal.grade,
    )})을 함께 본 판단입니다.`;

  const entryGuide =
    ready && !hasRisk
      ? '다음 진입 가능 거래일 시가에서 조건이 유지되는지 다시 확인'
      : (unmetConditions[0]?.label ??
        riskFlags[0]?.label ??
        '공시와 차트 근거를 상세 화면에서 먼저 확인');

  const invalidationGuide =
    riskFlags[0]?.label ??
    unmetConditions[0]?.label ??
    '필수 진입 조건이 하나라도 깨지면 계획 중단';

  return {
    tone,
    verdict,
    rationale,
    eventLabel: getEventTypeLabel(signal.eventType ?? 'OTHER'),
    metConditions,
    unmetConditions,
    riskFlags,
    entryGuide,
    invalidationGuide,
    hasShortMomentumScenario: signal.buyScore >= SHORT_MOMENTUM_RULE.minBuyScore,
  };
}

export function buildEditionDecision(
  signals: TradingSignal[],
  historical = false,
): EditionDecisionModel {
  const plans = signals.map(buildEditionSignalPlan);
  const readyCount = plans.filter((plan) => plan.tone === 'ready').length;
  const riskCount = plans.filter((plan) => plan.tone === 'risk').length;
  const checkCount = signals.length - readyCount;
  const prefix = historical ? '당시' : '오늘';

  let tone: EditionDecisionTone;
  let headline: string;

  if (readyCount === signals.length && readyCount > 0) {
    tone = 'ready';
    headline =
      readyCount === 1
        ? `${signals[0].corpName}, 조건부로 살펴볼 만해요`
        : `${signals[0].corpName} 등 ${readyCount}개를 조건부로 살펴볼 만해요`;
  } else if (readyCount > 0) {
    tone = 'mixed';
    headline = `${readyCount}개는 조건부 검토, ${checkCount}개는 확인이 먼저예요`;
  } else {
    tone = 'wait';
    headline = '매수 등급 신호는 있지만, 진입보다 확인이 먼저예요';
  }

  const firstReadyIndex = plans.findIndex((plan) => plan.tone === 'ready');
  const topIndex = firstReadyIndex >= 0 ? firstReadyIndex : 0;
  const topPlan = plans[topIndex];
  const topSignal = signals[topIndex];
  const topPriority =
    topSignal && topPlan
      ? `${topIndex + 1}순위 ${topSignal.corpName} · ${topPlan.verdict}`
      : '우선 확인할 종목이 없어요';

  return {
    tone,
    eyebrow: `${prefix}의 종합 의견`,
    headline,
    description: `매수 등급 ${signals.length}개를 진입 조건과 리스크까지 함께 정리했어요.`,
    readyCount,
    checkCount,
    riskCount,
    topPriority,
  };
}
