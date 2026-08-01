// 온보딩 단계 흐름 — DAR-209.
// intro 캐러셀이 약속한 가치(실시간 공시 → AI 투자판단 → 거장 철학)가 가입 직후
// 온보딩(관심기업·푸시)에서 끊겼다. 마지막에 '신호·포트폴리오 가치' 단계를 추가해
// 첫 사용자가 핵심 차별기능(AI 매수 판단)을 안내받게 한다.
//
// 이 파일은 React Native 의존성이 없는 순수 로직만 둔다 — 화면(onboarding/index.tsx)과
// 결정론 검증(scripts/check-onboarding-value-step.ts)이 함께 import 해 드리프트를 막는다.

/** 온보딩 총 단계 수: 1) 관심기업 2) 푸시알림 3) 신호·포트폴리오 가치 */
export const ONBOARDING_TOTAL_STEPS = 3 as const;

export type OnboardingStep = 1 | 2 | 3;

/** 레거시 호출 호환용 종료 선택. AOS에서는 두 경로 모두 판단 탭으로 수렴한다. */
export type OnboardingExit = 'signals' | 'home';

/**
 * 단계 전이 머신.
 * - 1단계 '계속/건너뛰기' → 2단계
 * - 2단계 '알림 받기/나중에' → 3단계(가치 안내)  ← DAR-209 추가
 * - 3단계 'continue' → 종료(완료) = null
 */
export function nextOnboardingStep(current: OnboardingStep): OnboardingStep | null {
  switch (current) {
    case 1:
      return 2;
    case 2:
      return 3;
    case 3:
      return null; // 온보딩 완료 → 탭으로 이동
  }
}

/** 마지막 단계 종료 선택 → 진입할 탭 라우트. */
export function onboardingExitRoute(_exit: OnboardingExit): '/(tabs)/signals' {
  return '/(tabs)/signals';
}
