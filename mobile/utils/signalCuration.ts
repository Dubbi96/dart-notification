// 신호 큐레이션 단일 출처(DAR-116) — "오늘 주목할 신호" L1 슬롯과 홈 프리뷰가 공유한다.
// 정직 원칙(§2·§6): 매수등급(STRONG_BUY/BUY)만 점수 내림차순 상위 N. WATCH 이하는 큐레이션 제외.
// 매수등급 0이면 가짜 BUY를 만들지 않고 빈 배열을 반환한다(호출부가 '점수순 탐색' CTA로 유도).

import type { SignalGrade, TradingSignal } from '@app-types/signal.types';

/** 큐레이션에 노출하는 '매수등급' — 가짜 BUY 금지(§2). WATCH 이하는 제외. */
export const CURATION_BUY_GRADES: readonly SignalGrade[] = ['STRONG_BUY', 'BUY'];

/** L1 큐레이션 기준 라벨(블랙박스·과신 방지, §6). 정렬·선별 근거를 명시한다. */
export const CURATION_CRITERIA_LABEL = '공시 기반 점수순 상위';

/** 신호 탭 L1 큐레이션 최대 노출 건수(3~5건). */
export const CURATION_MAX = 5;

/**
 * 매수등급만 점수 내림차순으로 상위 N건 선별(가짜 BUY 금지).
 * @param signals 전체 매수 신호 피드
 * @param max 상위 건수(기본 CURATION_MAX)
 */
export function curateBuySignals(
  signals: TradingSignal[] | undefined,
  max: number = CURATION_MAX,
): TradingSignal[] {
  const buys = (signals ?? []).filter((s) => CURATION_BUY_GRADES.includes(s.grade));
  return [...buys].sort((a, b) => b.buyScore - a.buyScore).slice(0, max);
}
