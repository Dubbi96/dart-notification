/**
 * C3. Persona 적합도 (PersonaFitScore)
 * AI Phase 4가 생성한 personaViews를 Rule로 변환 — 새 AI 호출 없음
 * AI 금지영역: AI가 "PersonaFitScore = X"를 직접 결정하는 구조 금지.
 */

import { VIEW_SCORE } from '../config/buy-signal.config';

export interface PersonaView {
  persona: string;
  view: string; // 'POSITIVE' | 'WATCH' | 'NEUTRAL' | 'NEGATIVE'
  reason?: string;
}

export interface PersonaFitInput {
  personaViews: PersonaView[];
  userPersona: string;
}

export function scorePersonaFit(input: PersonaFitInput): number {
  const matched = input.personaViews.find(
    (v) => v.persona === input.userPersona,
  );
  if (!matched) return 0;
  return VIEW_SCORE[matched.view] ?? 0;
}
