// Engine3 — 2단 자본 프레임 상수 (DAR-493 [견고화 W1·P16])
//
// 신규 2트랙(코어 듀얼모멘텀 P12 / 위성 변동성돌파 P14)의 자본 배분 프레임. a-priori frozen.
// 이 프레임은 **백테스트 엣지 게이트 통과 후** forward 활성 시 사용할 배분 비율을 선기재한 것이다
// (활성 배선은 P13/P15 소관 — 이 이슈는 게이트 계산 코드까지). 룰북 §9 프레임 절과 1:1.
//
// ★값 변경 절대 규칙: 룰북 §8 3게이트(문서 개정→재검증→사람 승인) 없이 변경 금지. AI 자동조정 금지(§8.4).

import { CORE_CAPITAL_ALLOCATION_PCT } from '../dual-momentum/dual-momentum.constants';
import { SATELLITE_CAPITAL_ALLOCATION_PCT } from '../volatility-breakout/volatility-breakout.constants';

/** 코어(듀얼모멘텀) 자본 비율 — 65%. dual-momentum.constants 의 값을 그대로 승계(SSOT 단일화). */
export const FRAME_CORE_PCT = CORE_CAPITAL_ALLOCATION_PCT;

/** 위성(변동성 돌파) 자본 비율 — 25%. volatility-breakout.constants 의 값을 그대로 승계. */
export const FRAME_SATELLITE_PCT = SATELLITE_CAPITAL_ALLOCATION_PCT;

/** 현금 버퍼 비율 — 10%. (드로우다운 완충·리밸런싱 유동성.) frozen. */
export const FRAME_CASH_BUFFER_PCT = 0.1;

/**
 * 2단 자본 프레임(frozen 상수 묶음). 합 = 1.0 (스펙 회귀 고정).
 * ★코어/위성 비율은 각 트랙 상수에서 승계 — 값 불일치 시 스펙이 실패(드리프트 방지).
 */
export const TWO_TIER_CAPITAL_FRAME = {
  corePct: FRAME_CORE_PCT,
  satellitePct: FRAME_SATELLITE_PCT,
  cashBufferPct: FRAME_CASH_BUFFER_PCT,
} as const;

/** 프레임 비율 합(=1.0 이어야 함). 부동소수 오차 방지를 위해 반올림 대조에 사용. */
export const FRAME_TOTAL_PCT = FRAME_CORE_PCT + FRAME_SATELLITE_PCT + FRAME_CASH_BUFFER_PCT;
