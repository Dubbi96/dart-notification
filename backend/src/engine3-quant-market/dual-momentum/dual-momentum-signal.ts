// Engine3 — 듀얼모멘텀 코어 월말 리밸런싱 판정 (순수 Rule, DAR-492 [견고화 W1·P12])
//
// AI 금지영역 불가침: 모멘텀·목표 배분 판정은 일봉 수정종가 기반 순수 수식. AI/LLM 개입 0.
// 이 모듈은 "판정 정의"만 소유한다(engine3 = 시세·지표 도메인). forward 트랙 배선·월말 크론·
// 매도→매수 실행·DB 영속은 P13 이 독립 강제한다. 백테스트 엣지 게이트는 P16.
// 순수 함수라 fixture 로 결정론적 검증 가능(volatility-breakout-signal §9.1/DAR-491 패턴 준용).
//
// 전략(한국형 듀얼모멘텀 = Antonacci GEM 변형, 코어 자본 65%):
//   판정 시점 = 매월 마지막 거래일 1회 (월말 거래일 판정은 P09 market-calendar 로 P13 이 수행)
//   MomA = TIGER 미국S&P500(360750) 12개월(252거래일) 수익률
//   MomB = KODEX 200(069500)        12개월 수익률
//   MomT = KODEX 단기채권(153130)    12개월 수익률 (절대모멘텀 임계 = 무위험 대용)
//   IF max(MomA, MomB) > MomT → 목표 = argmax(A,B) 100%      (상대 모멘텀 승자)
//   ELSE                      → 목표 = 종합채권(273130) 100% (절대 모멘텀 미충족 → 방어)
//   현재 보유 == 목표면 무행동(리밸런싱 생략 — 회전 최소화)
//   데이터 결측(253봉 미만·window 결측일) → null = 매매 보류 + 전월 포지션 유지(fail-safe)

import {
  MOMENTUM_LOOKBACK_DAYS,
  MIN_MOMENTUM_BARS,
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_DEFENSE_BOND_CODE,
} from './dual-momentum.constants';

/** 일봉 1개(모멘텀 산출은 수정종가만 사용). EtfDailyPrice.closePrice 매핑. */
export interface MomentumBar {
  /** 수정종가(원). ETF는 분배락 반영 종가 전제(호출자 주입). */
  close: number;
}

/** 유한 양수 검사(가격 가드). */
function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * 12개월(룩백 거래일) 수익률 = 현재 종가 / 룩백일 전 종가 − 1.
 *
 * @param bars     일봉 배열(오름차순, **마지막 원소 = 판정 시점 종가**). 수정종가 기준.
 * @param lookback 룩백 거래일. 기본 252(frozen).
 * @returns 수익률(소수, 예: 0.153 = +15.3%), 또는 null(이력 부족/window 결측·무효 → 매매 보류).
 *
 * fail-safe:
 *   - 이력 < 최소 봉수(룩백+1) → null. (이슈: 13개월 미만 이력 → null.)
 *   - 룩백 window(현재봉 ~ 룩백일 전) 안에 비유한/비양수 종가가 하나라도 있으면 null(결측일 방어).
 */
export function computeMomentum(
  bars: readonly MomentumBar[] | null | undefined,
  lookback: number = MOMENTUM_LOOKBACK_DAYS,
): number | null {
  if (!bars || !Array.isArray(bars)) return null;
  if (!Number.isInteger(lookback) || lookback <= 0) return null;

  const minBars = lookback + 1;
  if (bars.length < minBars) return null; // 이력 부족(결측) → 보류

  const lastIdx = bars.length - 1;
  const pastIdx = lastIdx - lookback;

  // window(pastIdx..lastIdx) 전 구간 유효성 — 결측일(null/NaN/≤0) 방어.
  for (let i = pastIdx; i <= lastIdx; i++) {
    const bar = bars[i];
    if (!bar || !isPositiveFinite(bar.close)) return null;
  }

  const current = bars[lastIdx].close;
  const past = bars[pastIdx].close;
  return current / past - 1;
}

/**
 * 목표 보유 ETF 판정 = 상대 모멘텀(argmax A,B) ∧ 절대 모멘텀 필터(> MomT).
 *
 * @returns 목표 ETF 코드(공격A/공격B/방어채권), 또는 null(모멘텀 결측 → 매매 보류).
 *
 * 규칙:
 *   - 입력 중 하나라도 null/비유한 → null(fail-safe: 판정 불가 → 전월 유지).
 *   - max(MomA, MomB) > MomT → argmax 자산 100%.
 *   - 그 외(공격 모멘텀이 단기채 이하) → 종합채권(273130) 100%.
 * argmax 동점(MomA == MomB) 타이브레이크: 공격A(해외 S&P500) 우선 — a-priori frozen(결정론 보장).
 */
export function decideDualMomentumTarget(
  momA: number | null,
  momB: number | null,
  momT: number | null,
): string | null {
  if (momA === null || momB === null || momT === null) return null;
  if (!Number.isFinite(momA) || !Number.isFinite(momB) || !Number.isFinite(momT)) return null;

  const maxOffense = Math.max(momA, momB);
  if (maxOffense > momT) {
    // argmax(A,B), 동점 시 A(해외) 우선(frozen tiebreak).
    return momA >= momB ? CORE_OFFENSE_INTL_CODE : CORE_OFFENSE_DOMESTIC_CODE;
  }
  return CORE_DEFENSE_BOND_CODE;
}

/** 리밸런싱 행동 — 무행동(목표=현재) 또는 교체(매도→매수). */
export type RebalanceAction = 'HOLD' | 'SWITCH';

/**
 * 현재 보유 vs 목표 → 리밸런싱 행동 판정.
 *
 * @param currentHolding 현재 보유 ETF 코드(무보유 시 null).
 * @param target         목표 ETF 코드(decideDualMomentumTarget 의 non-null 결과).
 * @returns 'HOLD'(목표==현재 → 리밸런싱 생략·회전 최소화) | 'SWITCH'(교체 필요).
 *
 * ★실행 순서 명세(P13 소관): SWITCH 시 **현재 보유 전량 매도 → 목표 자산 매수** 순서로 집행한다
 *   (현금 확보 후 진입, 미체결·부분체결 방어는 P13). 이 함수는 판정만 반환한다(부수효과 0).
 */
export function resolveRebalanceAction(
  currentHolding: string | null,
  target: string,
): RebalanceAction {
  return currentHolding === target ? 'HOLD' : 'SWITCH';
}

/** 월말 리밸런싱 판정 결과(판정 surface — P13 forward 배선이 소비). */
export interface DualMomentumDecision {
  /** 목표 보유 ETF 코드. 판정 불가(결측) 시 null. */
  target: string | null;
  /** 리밸런싱 행동. 보류(suspended) 시 'HOLD'(전월 유지=무주문). */
  action: RebalanceAction;
  /** 결측 fail-safe — true 면 판정 보류(전월 포지션 유지·무주문). */
  suspended: boolean;
  /** 산출 모멘텀(감사·표면화용). 결측 시 해당 값 null. */
  momentums: { a: number | null; b: number | null; t: number | null };
  /** 사람이 읽는 요약(판정/보류 사유). */
  detail: string;
}

/**
 * 월말 듀얼모멘텀 리밸런싱 판정(순수 함수) — 모멘텀 3종 산출 + 목표 판정 + 행동 결정을 조립한다.
 * 월말 거래일 트리거·매도→매수 실행·종목당 dedup·DB 영속은 P13 이 강제한다(이 함수는 부수효과 0).
 *
 * @param barsA           공격A(360750) 일봉(오름차순, 마지막=판정 시점).
 * @param barsB           공격B(069500) 일봉.
 * @param barsT           절대모멘텀 임계(153130 단기채) 일봉.
 * @param currentHolding  현재 보유 ETF 코드(무보유 시 null).
 * @param lookback        룩백 거래일(미지정 시 252 frozen).
 */
export function decideMonthlyRebalance(
  barsA: readonly MomentumBar[] | null | undefined,
  barsB: readonly MomentumBar[] | null | undefined,
  barsT: readonly MomentumBar[] | null | undefined,
  currentHolding: string | null,
  lookback: number = MOMENTUM_LOOKBACK_DAYS,
): DualMomentumDecision {
  const momA = computeMomentum(barsA, lookback);
  const momB = computeMomentum(barsB, lookback);
  const momT = computeMomentum(barsT, lookback);
  const momentums = { a: momA, b: momB, t: momT };

  const target = decideDualMomentumTarget(momA, momB, momT);

  if (target === null) {
    // fail-safe: 모멘텀 결측(이력 부족·window 결측일) → 매매 보류, 전월 포지션 유지(무주문).
    return {
      target: null,
      action: 'HOLD',
      suspended: true,
      momentums,
      detail: `모멘텀 결측(${MIN_MOMENTUM_BARS}봉 미만 이력·window 결측일) — 매매 보류, 전월 포지션(${
        currentHolding ?? '없음'
      }) 유지`,
    };
  }

  const action = resolveRebalanceAction(currentHolding, target);
  const detail =
    action === 'HOLD'
      ? `목표 ${target} == 현재 보유 — 리밸런싱 생략(회전 최소화)`
      : `SWITCH: ${currentHolding ?? '현금'} → ${target} (전량 매도 후 매수; 실행은 P13)`;

  return { target, action, suspended: false, momentums, detail };
}
