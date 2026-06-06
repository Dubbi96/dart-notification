// 신호→진입 퍼널 리포트 — 순수 Rule 함수 (DAR-109)
//
// '당일 생성 신호 수 → 진입 후보 통과 수 → 실제 체결 수'를 일별/누적으로 집계하고
// 전환율(채택률·체결률·신호→체결)을 파생한다. 분모 0이면 rate=null(가짜 비율 금지).
// AI 금지영역: 순수 카운트·나눗셈. AI 개입 0.

import { FunnelDaily } from './simulation.types';

/** 일별 퍼널 + 파생 전환율 */
export interface FunnelDayReport extends FunnelDaily {
  /** 채택률 = 후보 통과 / 생성 신호 (0~1, 신호 0이면 null) */
  adoptionRate: number | null;
  /** 체결률 = 체결 / 후보 통과 (0~1, 후보 0이면 null) */
  fillRate: number | null;
  /** 신호→체결 전환율 = 체결 / 생성 신호 (0~1, 신호 0이면 null) */
  conversionRate: number | null;
}

/** 누적 퍼널(전 기간 합산) + 전환율 + 운용일수 */
export interface FunnelTotals {
  days: number;
  signalsGenerated: number;
  candidatesPassed: number;
  filled: number;
  adoptionRate: number | null;
  fillRate: number | null;
  conversionRate: number | null;
}

export interface FunnelReport {
  /** 거래일 오름차순 일별 퍼널 */
  daily: FunnelDayReport[];
  /** 전 기간 누적 */
  totals: FunnelTotals;
}

/** 분모 0 보호 비율(0~1). 분모 ≤ 0 이면 null(측정 불가 — 가짜 비율 금지). */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** 일별 퍼널 레코드 배열 → 일별 전환율 + 누적 리포트(순수). */
export function buildFunnelReport(records: FunnelDaily[]): FunnelReport {
  const sorted = [...records].sort((a, b) =>
    a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0,
  );

  const daily: FunnelDayReport[] = sorted.map((r) => ({
    tradeDate: r.tradeDate,
    signalsGenerated: r.signalsGenerated,
    candidatesPassed: r.candidatesPassed,
    filled: r.filled,
    adoptionRate: ratio(r.candidatesPassed, r.signalsGenerated),
    fillRate: ratio(r.filled, r.candidatesPassed),
    conversionRate: ratio(r.filled, r.signalsGenerated),
  }));

  const signalsGenerated = sorted.reduce((s, r) => s + r.signalsGenerated, 0);
  const candidatesPassed = sorted.reduce((s, r) => s + r.candidatesPassed, 0);
  const filled = sorted.reduce((s, r) => s + r.filled, 0);

  return {
    daily,
    totals: {
      days: sorted.length,
      signalsGenerated,
      candidatesPassed,
      filled,
      adoptionRate: ratio(candidatesPassed, signalsGenerated),
      fillRate: ratio(filled, candidatesPassed),
      conversionRate: ratio(filled, signalsGenerated),
    },
  };
}
