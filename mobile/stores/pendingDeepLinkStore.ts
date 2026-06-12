import { create } from 'zustand';

/**
 * DAR-154: 콜드스타트 딥링크 인증 게이트 경쟁 해소.
 *
 * 앱 종료 상태에서 알림 탭으로 콜드스타트하면, 딥링크 대상을 즉시 push 하지 않고
 * 이 스토어에 'pending target'으로 보관한다. 인증·스토어 하이드레이션·온보딩이 끝나
 * 인증 게이트(`app/index.tsx`)를 통과한 뒤(= 메인 앱 진입 상태)에 한 번만 소비한다.
 *
 * 이로써 (1) 비로그인 상태에서 `/signals/{id}` 진입 → 401, (2) 게이트 리다이렉트에
 * push 가 덮여 사라지는 경쟁을 방지하고, (3) 임의 고정 지연(500ms) 의존을 제거한다.
 * 보관은 단일 JS 세션(인메모리) — 콜드스타트 직후 1회 설정되므로 영속(SecureStore) 불필요.
 */
interface PendingDeepLinkState {
  pendingDeepLink: string | null;
  setPendingDeepLink: (path: string) => void;
  /** 보류된 대상을 반환하고 비운다(1회 소비). 없으면 null. */
  consumePendingDeepLink: () => string | null;
}

export const usePendingDeepLinkStore = create<PendingDeepLinkState>((set, get) => ({
  pendingDeepLink: null,
  setPendingDeepLink: (path) => set({ pendingDeepLink: path }),
  consumePendingDeepLink: () => {
    const current = get().pendingDeepLink;
    if (current !== null) {
      set({ pendingDeepLink: null });
    }
    return current;
  },
}));

/**
 * 게이트 통과 판정(순수 함수). `app/index.tsx` 의 '홈(메인 앱) 진입' 조건과 1:1 일치:
 * 인증 + 온보딩 완료 시에만 보류된 딥링크를 소비한다.
 * 비로그인·온보딩 미완·보류 없음이면 false → 보류를 그대로 유지(로그인 후 동선으로 이어짐).
 */
export function shouldConsumePendingDeepLink(params: {
  pendingDeepLink: string | null;
  isAuthenticated: boolean;
  onboardingCompleted: boolean;
}): boolean {
  return (
    params.pendingDeepLink !== null &&
    params.isAuthenticated &&
    params.onboardingCompleted
  );
}
