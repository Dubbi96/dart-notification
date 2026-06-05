/**
 * C1. 공시 이벤트 점수 (DisclosureEventScore)
 * 이벤트 타입 기본 점수 + polarity(AI Phase 4 결과) 보정
 * AI 금지영역: polarity를 점수로 변환하는 것은 순수 Rule. AI가 점수를 직접 결정 금지.
 */

import { EVENT_BASE_SCORES } from '../config/buy-signal.config';

export interface DisclosureEventInput {
  eventType: string;
  polarity: string; // 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function scoreDisclosureEvent(input: DisclosureEventInput): number {
  const base = EVENT_BASE_SCORES[input.eventType] ?? 0;

  let adjusted: number;
  switch (input.polarity) {
    case 'NEGATIVE':
      adjusted = base * 0.5;
      break;
    case 'MIXED':
      adjusted = base * 0.7;
      break;
    default:
      adjusted = base;
  }

  return clamp(adjusted, -100, 100);
}
