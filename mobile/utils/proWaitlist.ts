// Pro 출시 알림 사전 신청 토글의 순수 로직(DAR-204).
// UI/스토어에서 분리해 결정론적으로 검증 가능하게 한다.

export type WaitlistHaptic = 'success' | 'light';

export interface WaitlistToggleResult {
  /** 토글 후의 신청 상태 */
  next: boolean;
  /** 사용자에게 보여줄 스낵바 문구 */
  message: string;
  /** 발생시킬 햅틱 종류 */
  haptic: WaitlistHaptic;
}

/**
 * 현재 신청 상태를 받아 토글 결과(다음 상태·문구·햅틱)를 계산한다.
 * - 미신청 → 신청: 성공 햅틱 + 안내
 * - 신청 → 취소: 가벼운 햅틱 + 취소 안내
 */
export function toggleWaitlist(current: boolean): WaitlistToggleResult {
  const next = !current;
  return next
    ? { next, message: '출시되면 알려드릴게요', haptic: 'success' }
    : { next, message: '알림 신청을 취소했어요', haptic: 'light' };
}
