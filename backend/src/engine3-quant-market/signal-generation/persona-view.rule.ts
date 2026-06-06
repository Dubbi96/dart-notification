/**
 * Persona 관점(view) 파생 규칙 — 순수 Rule (DAR-41)
 *
 * AI 금지영역: persona 적합도 view 는 순수 Rule 로 파생한다. AI/LLM 개입 절대 금지.
 *
 * 배경: `scorePersonaFit` 는 persona 별 view(POSITIVE|WATCH|NEUTRAL|NEGATIVE)를 입력으로 받는다.
 * 런타임 신호 생성 시 AI persona-interpretation(L2)은 금지영역이므로,
 * eventType × polarity 만으로 결정되는 결정론적 affinity 테이블로 view 를 파생한다.
 * (가중치 15% — 분포에 미세 변별만 부여, 쏠림 방지)
 *
 * DAR-79: 동일 이벤트라도 기업 규모 대비 임팩트가 다르다. 매수/임팩트 판단이 절대 금액이 아닌
 * 상대 비율(salesRatio·buybackRatioToSales 등)을 우선 반영하도록, 선택적 `impact` 인자로
 * 임팩트 규모(materiality)를 받아 우호(FAVORED) 긍정 이벤트의 view 강도를 보정한다.
 * 비율 결측 시 절대 금액으로 폴백하고, 둘 다 결측이면 기존 동작(규모 미반영)을 그대로
 * 유지한다(회귀 0). 순수 Rule.
 */

import { PersonaView } from '../buy-signal/scoring/persona-fit.scorer';
import { PERSONA_TYPES, PersonaType } from '../buy-signal/config/buy-signal.config';

type Affinity = 'FAVORED' | 'NEUTRAL' | 'AVERSE';

/** 임팩트 규모 등급 (상대비율 우선, 절대금액 폴백, 미상) */
type Materiality = 'HIGH' | 'LOW' | 'UNKNOWN';

/**
 * 이벤트 임팩트 규모 입력 (DAR-79). 모두 선택적 — 미지정 시 규모 미반영(기존 동작).
 */
export interface ImpactMagnitude {
  /** 규모 정규화 비율(%) — salesRatio·buybackRatioToSales 등. 절대금액보다 우선. */
  relativeRatio?: number | null;
  /** 절대 금액(원) — 비율 결측 시 폴백 판단용. */
  absoluteAmount?: number | null;
}

/** 상대비율 임팩트 임계치(%). 1% 미만이면 규모 미미(LOW). key-metric.scorer 최소 변별선과 정합. */
const RATIO_MATERIAL_THRESHOLD = 1;
/** 절대금액 폴백 임계치(원). 비율 결측 시에만 사용하는 coarse 기준(10억원 미만이면 LOW). */
const ABS_MATERIAL_THRESHOLD = 1_000_000_000;

/**
 * 임팩트 규모 등급 산정 — 상대비율 우선, 결측 시 절대금액 폴백, 둘 다 결측이면 UNKNOWN.
 */
function materialityOf(impact?: ImpactMagnitude): Materiality {
  if (impact) {
    const { relativeRatio, absoluteAmount } = impact;
    if (typeof relativeRatio === 'number' && isFinite(relativeRatio)) {
      return relativeRatio >= RATIO_MATERIAL_THRESHOLD ? 'HIGH' : 'LOW';
    }
    if (typeof absoluteAmount === 'number' && isFinite(absoluteAmount)) {
      return absoluteAmount >= ABS_MATERIAL_THRESHOLD ? 'HIGH' : 'LOW';
    }
  }
  return 'UNKNOWN';
}

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

/** (affinity, polarity, materiality) → view */
function viewFor(
  affinity: Affinity,
  polarity: string,
  materiality: Materiality,
): PersonaView['view'] {
  switch (polarity) {
    case 'POSITIVE':
      if (affinity === 'FAVORED') {
        // DAR-79: 규모가 미미(LOW)한 우호 긍정 이벤트는 강한 POSITIVE 대신 WATCH로 보정.
        //   규모 미상(UNKNOWN)이면 기존 동작 그대로(POSITIVE) → 회귀 0.
        return materiality === 'LOW' ? 'WATCH' : 'POSITIVE';
      }
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
 *
 * @param impact (DAR-79, 선택) 이벤트 임팩트 규모. 상대비율 우선·절대금액 폴백으로 우호 이벤트의
 *   view 강도를 보정한다. 미지정 시 규모 미반영(기존 동작 유지, 회귀 0).
 */
export function derivePersonaViews(
  eventType: string,
  polarity: string,
  impact?: ImpactMagnitude,
): PersonaView[] {
  const materiality = materialityOf(impact);
  return PERSONA_TYPES.map((persona) => ({
    persona,
    view: viewFor(affinityFor(persona, eventType), polarity, materiality),
  }));
}
