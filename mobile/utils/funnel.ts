// 온보딩 퍼널 계측 순수 로직 (갭분석 W15 ③).
//
// install → intro → kakao → watchlist(관심기업) → push_permission(푸시권한) 5단계를
// backend FunnelEvent(POST /ops/funnel)로 기록한다. 이 파일은 RN 의존성이 없는
// 순수 로직만 둔다 — 전송(services/funnel.service.ts)과 유닛 테스트(__tests__/)가
// 함께 import 해 드리프트를 막는다.
//
// ★백엔드 미러: backend/src/ops/dto/record-funnel-event.dto.ts 의 FUNNEL_STEPS 와
//   정확히 일치해야 한다(계측 SSOT).
// ★계측 전용 — 온보딩 UI/흐름 재설계 금지(측정만). 실패는 무시(fire-and-forget).

export const FUNNEL_STEPS = [
  'install',
  'intro',
  'kakao',
  'watchlist',
  'push_permission',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export function isFunnelStep(value: string): value is FunnelStep {
  return (FUNNEL_STEPS as readonly string[]).includes(value);
}

/** 서버 전송 페이로드 — backend RecordFunnelEventDto 와 형태 일치. */
export interface FunnelPayload {
  anonId: string;
  step: FunnelStep;
  meta?: Record<string, unknown>;
}

/**
 * 전송 페이로드 조립. 빈 meta({})는 서버에 무의미한 Json 을 남기지 않도록 생략한다.
 */
export function buildFunnelPayload(
  anonId: string,
  step: FunnelStep,
  meta?: Record<string, unknown>,
): FunnelPayload {
  if (meta && Object.keys(meta).length > 0) {
    return { anonId, step, meta };
  }
  return { anonId, step };
}

/**
 * '설치당 1회' 단계의 전송 여부 SecureStore 키.
 * SecureStore 키는 영숫자·'.'·'-'·'_' 만 허용되므로 이 형식을 유지한다.
 */
export function funnelSentKey(step: FunnelStep): string {
  return `funnel.sent.${step}`;
}

/** anonId 영속 SecureStore 키. */
export const FUNNEL_ANON_ID_KEY = 'funnel.anonId';
