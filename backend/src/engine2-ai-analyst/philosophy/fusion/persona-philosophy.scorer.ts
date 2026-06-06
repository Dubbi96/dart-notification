/**
 * Persona 철학 엔진 P-C — AI Persona 해석 × 철학 스코어러 결합 (순수 Rule, DAR-72)
 *
 * 두 개의 **기존 Rule 자산**을 신규 AI 호출 없이 결합한다:
 *   1. persona-fit (engine3 `scorePersonaFit`): persona 별 view 레이블 → VIEW_SCORE Rule.
 *   2. philosophy-fit (engine2 `scorePhilosophyFit`): 거장 철학 × 재무 적합도(0~100) Rule.
 *
 * AI 금지영역(핵심): 결합점수는 **반드시 Rule**. AI는 입력/레이블만 제공한다.
 *   - 저장된 AI personaViews(`{persona, interpretation, fitScore}`)에서 **fitScore 를
 *     직결하지 않는다**. Rule 임계로 이산화(POSITIVE|WATCH|NEUTRAL|NEGATIVE 레이블)한 뒤
 *     engine3 VIEW_SCORE Rule 로 재점수화한다 — 즉 "AI 뷰 레이블 → Rule 점수".
 *   - interpretation 텍스트는 설명(근거)용으로만 동반되며 점수에 가산되지 않는다.
 *
 * 결측 폴백: 한 축이 없으면(재무 결측 / AI 해석 미산출) 가용 축만으로 가중치를
 * 재정규화한다(DAR-49 패턴). 두 축 모두 없으면 computable=false, score=null.
 *
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §4 P-C
 */
import {
  PersonaView,
  scorePersonaFit,
} from '../../../engine3-quant-market/buy-signal/scoring/persona-fit.scorer';
import { VIEW_SCORE } from '../../../engine3-quant-market/buy-signal/config/buy-signal.config';

/** AI persona-interpretation(L2)이 사용하는 성향 키 */
export type AiPersonaKey =
  | 'CONSERVATIVE'
  | 'BALANCED'
  | 'AGGRESSIVE'
  | 'EVENT_DRIVEN';

/** 저장된 AI personaViews 1건(`PersonaAnalysisDraft` 구조) */
export interface StoredPersonaView {
  persona: string;
  interpretation: string;
  /** AI 산출 적합도(0~100). **결합점수에 직결 금지** — 레이블 이산화에만 사용 */
  fitScore: number;
}

/** 철학 적합도 입력(engine2 `PhilosophyFitScore` 의 결합용 축약) */
export interface PhilosophyFitFacet {
  philosophyId: string;
  investorName: string;
  styleTags: string[];
  /** 가용 지표 1개 이상 → true */
  computable: boolean;
  /** 0~100 또는 null(재무 결측) */
  score: number | null;
  /** 실제 평가된 지표 수(표본) */
  evaluatedCount: number;
  /** 철학이 정의한 전체 지표 수 */
  totalMetrics: number;
}

/** 결합 신뢰도(DAR-56 신뢰규약: 근거·표본·신뢰도 동반) */
export interface FusionConfidence {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  /** 0~1 — 두 축의 커버리지 가중 */
  value: number;
  /** 표본 수 = AI 뷰 가용(0|1) + 평가된 철학 지표 수 */
  sampleCount: number;
}

/** 거장 철학 × AI 관점 결합 결과 1건 */
export interface PersonaPhilosophyFusion {
  philosophyId: string;
  investorName: string;
  /** 철학 스타일 → 대응시킨 AI persona */
  mappedPersona: AiPersonaKey;
  /** persona-fit 입력으로 쓴 AI 뷰 레이블·텍스트(설명용) */
  personaView: {
    view: PersonaView['view'] | null;
    available: boolean;
    interpretation: string | null;
  };
  /** persona-fit Rule 점수 0~100(VIEW_SCORE 정규화). 미가용 시 null */
  personaFitScore: number | null;
  /** philosophy-fit Rule 점수 0~100. 미가용 시 null */
  philosophyScore: number | null;
  /** 결합점수 0~100(Rule 가중·재정규화). 두 축 모두 결측이면 null */
  fusionScore: number | null;
  /** 결합점수 산출 가능 여부 */
  computable: boolean;
  confidence: FusionConfidence;
  /** 근거(설명) */
  basis: string[];
}

/** 결합 가중치 — 순수 Rule 상수(AI 동적 변경 금지). 합=1.0 */
export const FUSION_WEIGHTS = {
  philosophy: 0.6, // 거장 철학(재무 근거) 우선
  persona: 0.4, // AI 관점(이산 레이블)
} as const;

/** AI fitScore → 이산 view 레이블 Rule 임계(AI 점수 직결 방지의 경계) */
export const AI_VIEW_LABEL_THRESHOLDS = {
  POSITIVE: 70,
  WATCH: 45,
  NEUTRAL: 25,
  // 미만 → NEGATIVE
} as const;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 철학 styleTags → AI persona 매핑(결정론적 Rule).
 * 우선순위: 모멘텀/매크로 → AGGRESSIVE, 성장 → BALANCED, 가치/해자 → CONSERVATIVE.
 * 매칭 없으면 BALANCED(중립 기본).
 */
export function mapPhilosophyToPersona(styleTags: string[]): AiPersonaKey {
  const tags = new Set(styleTags.map((t) => t.toUpperCase()));
  if (tags.has('MOMENTUM') || tags.has('MACRO')) return 'AGGRESSIVE';
  if (tags.has('GROWTH') || tags.has('GARP')) return 'BALANCED';
  if (
    tags.has('VALUE') ||
    tags.has('MOAT') ||
    tags.has('LONG_TERM') ||
    tags.has('QUANTITATIVE')
  ) {
    return 'CONSERVATIVE';
  }
  return 'BALANCED';
}

/**
 * AI personaView 의 fitScore 를 이산 view 레이블로 변환(Rule).
 * **AI 점수를 결합점수에 직결하지 않기 위한 이산화** — 결과는 engine3 VIEW_SCORE 로 재점수화된다.
 */
export function bucketAiViewLabel(fitScore: number): PersonaView['view'] {
  if (fitScore >= AI_VIEW_LABEL_THRESHOLDS.POSITIVE) return 'POSITIVE';
  if (fitScore >= AI_VIEW_LABEL_THRESHOLDS.WATCH) return 'WATCH';
  if (fitScore >= AI_VIEW_LABEL_THRESHOLDS.NEUTRAL) return 'NEUTRAL';
  return 'NEGATIVE';
}

/** VIEW_SCORE 원점수(-60~100) → 0~100 정규화 */
export function normalizePersonaRaw(raw: number): number {
  const MIN = VIEW_SCORE.NEGATIVE; // -60
  const MAX = VIEW_SCORE.POSITIVE; // 100
  return round2(clamp01((raw - MIN) / (MAX - MIN)) * 100);
}

function levelOf(value: number): FusionConfidence['level'] {
  if (value >= 0.66) return 'HIGH';
  if (value >= 0.33) return 'MEDIUM';
  return 'LOW';
}

/**
 * 거장 철학 1종 × 저장된 AI personaViews → 결합(순수 Rule).
 *
 * @param philosophy engine2 철학 적합도 facet
 * @param storedViews 저장된 AI personaViews(없으면 빈 배열)
 */
export function fusePersonaPhilosophy(
  philosophy: PhilosophyFitFacet,
  storedViews: StoredPersonaView[],
): PersonaPhilosophyFusion {
  const mappedPersona = mapPhilosophyToPersona(philosophy.styleTags);

  // 1) persona-fit 축: 저장된 AI 뷰를 레이블로 이산화 → engine3 Rule 재점수화
  const matched = storedViews.find((v) => v.persona === mappedPersona);
  let personaFitScore: number | null = null;
  let personaView: PersonaPhilosophyFusion['personaView'] = {
    view: null,
    available: false,
    interpretation: null,
  };
  if (matched) {
    const view = bucketAiViewLabel(matched.fitScore);
    // engine3 persona-fit 과 동일 패턴(Rule): personaViews 입력 → VIEW_SCORE
    const personaViews: PersonaView[] = storedViews.map((v) => ({
      persona: v.persona,
      view: bucketAiViewLabel(v.fitScore),
    }));
    const raw = scorePersonaFit({ personaViews, userPersona: mappedPersona });
    personaFitScore = normalizePersonaRaw(raw);
    personaView = {
      view,
      available: true,
      interpretation: matched.interpretation || null,
    };
  }

  // 2) philosophy-fit 축
  const philosophyScore =
    philosophy.computable && philosophy.score != null ? philosophy.score : null;

  // 3) Rule 결합 — 가용 축만으로 가중치 재정규화(DAR-49)
  const facets: Array<{ weight: number; score: number }> = [];
  if (philosophyScore != null) {
    facets.push({ weight: FUSION_WEIGHTS.philosophy, score: philosophyScore });
  }
  if (personaFitScore != null) {
    facets.push({ weight: FUSION_WEIGHTS.persona, score: personaFitScore });
  }

  let fusionScore: number | null = null;
  if (facets.length > 0) {
    const wSum = facets.reduce((s, f) => s + f.weight, 0);
    fusionScore = round2(
      facets.reduce((s, f) => s + f.score * f.weight, 0) / wSum,
    );
  }

  // 4) 신뢰도(근거·표본·신뢰도)
  const personaAvailable = personaFitScore != null;
  const philosophyAvailable = philosophyScore != null;
  const philosophyCoverage =
    philosophy.computable && philosophy.totalMetrics > 0
      ? clamp01(philosophy.evaluatedCount / philosophy.totalMetrics)
      : 0;
  const personaCoverage = personaAvailable ? 1 : 0;

  let confidenceValue: number;
  if (philosophyAvailable && personaAvailable) {
    confidenceValue = 0.5 * philosophyCoverage + 0.5 * personaCoverage;
  } else if (philosophyAvailable) {
    confidenceValue = 0.7 * philosophyCoverage; // 단일 축 — 감점
  } else if (personaAvailable) {
    confidenceValue = 0.5 * personaCoverage; // AI 단일 축 — 더 보수적
  } else {
    confidenceValue = 0;
  }
  confidenceValue = round2(confidenceValue);

  const sampleCount =
    (personaAvailable ? 1 : 0) +
    (philosophy.computable ? philosophy.evaluatedCount : 0);

  const basis: string[] = [];
  if (philosophyAvailable) {
    basis.push(
      `철학 적합도 ${philosophyScore}점(지표 ${philosophy.evaluatedCount}/${philosophy.totalMetrics} 평가, 가중 ${FUSION_WEIGHTS.philosophy})`,
    );
  } else {
    basis.push('철학 적합도 결측(재무 미확보) — 결합서 제외');
  }
  if (personaAvailable) {
    basis.push(
      `AI 관점(${mappedPersona}) 뷰=${personaView.view} → persona-fit ${personaFitScore}점(가중 ${FUSION_WEIGHTS.persona})`,
    );
  } else {
    basis.push(`AI 관점(${mappedPersona}) 미산출 — 결합서 제외`);
  }

  return {
    philosophyId: philosophy.philosophyId,
    investorName: philosophy.investorName,
    mappedPersona,
    personaView,
    personaFitScore,
    philosophyScore,
    fusionScore,
    computable: fusionScore != null,
    confidence: {
      level: levelOf(confidenceValue),
      value: confidenceValue,
      sampleCount,
    },
    basis,
  };
}
