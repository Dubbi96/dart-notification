import { AiTaskName } from '../types/ai-analyst.types';

/**
 * DAR-522 (Wave C1·P0) — PRICE_MOVE 역방향 리즈닝 공용 상수.
 * ★AI 금지영역 무접점: 이 도메인은 '왜 움직였나'의 설명(원인 해석·근거)만 생성한다.
 */

/** AIUsageLog 비용 귀속·DisclosureAnalysis 미사용(별도 refId 캐시) 태스크 식별자. */
export const PRICE_MOVE_REASONING_TASK: AiTaskName = 'price-move-reasoning';

/** 공시 역추적 룩백(시간) — engine3 price-move-alert 팩트체크(48h)와 동일 창. */
export const PRICE_MOVE_REASONING_LOOKBACK_HOURS = 48;

/**
 * 무공시(48h 0건) 포맷 응답 라벨 — 수용기준 (1). 분석 위장 금지:
 * AI 를 호출하지 않고 이 포맷만 반환/저장한다.
 */
export const NO_DISCLOSURE_LABEL = '관련 공시 없음(48h)';

/**
 * 일일 비용 상한 env(수용기준 (2)) — 이 태스크 전용 하루 예산(USD).
 * 전역 AiCostLimitGuard($1 일/$31 월)에 더해 역방향 리즈닝만의 상한을 강제한다.
 * 미설정/비정상이면 기본값. 초과 시 AI 호출 0(status=CAP_SKIPPED).
 */
export const PRICE_MOVE_REASONING_DAILY_LIMIT_ENV = 'PRICE_MOVE_REASONING_DAILY_USD_LIMIT';
export const PRICE_MOVE_REASONING_DEFAULT_DAILY_LIMIT_USD = 0.5;

/** 리즈닝 결과 상태. */
export type PriceMoveReasoningStatus = 'ANALYZED' | 'NO_DISCLOSURE' | 'CAP_SKIPPED';
