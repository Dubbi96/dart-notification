/**
 * Persona 관점(view) 파생 규칙 — 순수 Rule (DAR-41)
 *
 * AI 금지영역: persona 적합도 view 는 순수 Rule 로 파생한다. AI/LLM 개입 절대 금지.
 *
 * 배경: `scorePersonaFit` 는 persona 별 view(POSITIVE|WATCH|NEUTRAL|NEGATIVE)를 입력으로 받는다.
 * 런타임 신호 생성 시 AI persona-interpretation(L2)은 금지영역이므로,
 * eventType × polarity 만으로 결정되는 결정론적 affinity 테이블로 view 를 파생한다.
 * (가중치 15% — 분포에 미세 변별만 부여, 쏠림 방지)
 */

import { PersonaView } from '../buy-signal/scoring/persona-fit.scorer';
import { PERSONA_TYPES, PersonaType } from '../buy-signal/config/buy-signal.config';

type Affinity = 'FAVORED' | 'NEUTRAL' | 'AVERSE';

/** persona 별 선호 이벤트 타입 (긍정 촉매) */
const FAVORED_EVENTS: Record<PersonaType, ReadonlySet<string>> = {
  GROWTH: new Set([
    'SUPPLY_CONTRACT',
    'EARNINGS_SURPRISE',
    'DIVIDEND_INCREASE',
  ]),
  VALUE: new Set([
    'SHARE_BUYBACK',
    'SHARE_CANCELLATION',
    'DIVIDEND_INCREASE',
  ]),
  MOMENTUM: new Set([
    'SUPPLY_CONTRACT',
    'EARNINGS_SURPRISE',
    'MAJOR_SHAREHOLDER_CHANGE',
  ]),
  // 이벤트 트레이더 — 모든 긍정 촉매를 추종
  EVENT_DRIVEN: new Set([
    'SUPPLY_CONTRACT',
    'EARNINGS_SURPRISE',
    'DIVIDEND_INCREASE',
    'SHARE_BUYBACK',
    'SHARE_CANCELLATION',
    'MAJOR_SHAREHOLDER_CHANGE',
  ]),
};

/** 희석성 이벤트 (지분 희석 → 보수 persona 기피) */
const DILUTIVE_EVENTS: ReadonlySet<string> = new Set([
  'PAID_IN_CAPITAL_INCREASE',
  'THIRD_PARTY_ALLOTMENT',
  'CB_ISSUANCE',
  'BW_ISSUANCE',
]);

/** 부정 이벤트 (실적 쇼크·계약 해제·감사 위험 등) */
const NEGATIVE_EVENTS: ReadonlySet<string> = new Set([
  'EARNINGS_SHOCK',
  'CONTRACT_CANCELLATION',
  'AUDIT_OPINION_RISK',
  'TRADING_SUSPENSION',
  'DELISTING_RISK',
  'LAWSUIT',
  'DIVIDEND_CUT',
]);

function affinityFor(persona: PersonaType, eventType: string): Affinity {
  if (FAVORED_EVENTS[persona].has(eventType)) return 'FAVORED';
  if (DILUTIVE_EVENTS.has(eventType) || NEGATIVE_EVENTS.has(eventType)) {
    return 'AVERSE';
  }
  return 'NEUTRAL';
}

/** (affinity, polarity) → view */
function viewFor(affinity: Affinity, polarity: string): PersonaView['view'] {
  switch (polarity) {
    case 'POSITIVE':
      if (affinity === 'FAVORED') return 'POSITIVE';
      if (affinity === 'AVERSE') return 'NEUTRAL';
      return 'WATCH';
    case 'NEGATIVE':
      if (affinity === 'FAVORED') return 'WATCH';
      if (affinity === 'AVERSE') return 'NEGATIVE';
      return 'NEUTRAL';
    case 'MIXED':
      return affinity === 'FAVORED' ? 'WATCH' : 'NEUTRAL';
    default: // UNKNOWN
      return 'NEUTRAL';
  }
}

/**
 * 4 Persona 전부에 대한 view 목록을 결정론적으로 파생한다.
 * `scorePersonaFit({ personaViews, userPersona })` 의 personaViews 입력으로 사용.
 */
export function derivePersonaViews(
  eventType: string,
  polarity: string,
): PersonaView[] {
  return PERSONA_TYPES.map((persona) => ({
    persona,
    view: viewFor(affinityFor(persona, eventType), polarity),
  }));
}
