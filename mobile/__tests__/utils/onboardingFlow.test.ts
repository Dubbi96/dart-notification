import {
  ONBOARDING_TOTAL_STEPS,
  nextOnboardingStep,
  onboardingExitRoute,
} from '@utils/onboardingFlow';

// 온보딩 단계 전이 머신(DAR-209) — 화면(onboarding/index.tsx)과 결정론 체크가
// 공유하는 순수 로직의 회귀 가드.
describe('utils/onboardingFlow', () => {
  it('단계 전이: 1→2→3→완료(null)', () => {
    expect(nextOnboardingStep(1)).toBe(2);
    expect(nextOnboardingStep(2)).toBe(3);
    expect(nextOnboardingStep(3)).toBeNull();
  });

  it('총 단계 수는 3(관심기업·푸시알림·가치 안내)', () => {
    expect(ONBOARDING_TOTAL_STEPS).toBe(3);
  });

  it("종료 선택 'signals' → 신호 탭 라우트", () => {
    expect(onboardingExitRoute('signals')).toBe('/(tabs)/signals');
  });

  it("종료 선택 'home' → 홈 탭 라우트", () => {
    expect(onboardingExitRoute('home')).toBe('/(tabs)/home');
  });
});
