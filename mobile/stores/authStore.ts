import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { queryClient } from '@services/queryClient';
import { purgeServerCache } from '@utils/authCache';

const secureStorage: StateStorage = {
  getItem: async (name) => {
    return await SecureStore.getItemAsync(name);
  },
  setItem: async (name, value) => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name) => {
    await SecureStore.deleteItemAsync(name);
  },
};

// 인증 스토어는 인증 플래그·토큰 등 "클라이언트 상태"만 보유한다. 서버 User 데이터는
// React Query(`useMe().data`)가 SSOT — Zustand 에 복제하지 않는다(루트 CLAUDE.md: 서버 데이터
// Zustand 복제 금지 / DAR-262: 복제본과 useMe().data 의 stale 불일치 + 계정 전환 잔여 제거).
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  onboardingCompleted: boolean;
  expoPushToken: string | null;
  /** 로그인 성공: 토큰 저장 + 이전 세션(게스트/직전 유저) 서버 캐시 전량 제거. */
  setAuth: (accessToken: string, refreshToken: string) => void;
  /** 토큰 회전(refresh): 같은 사용자이므로 캐시는 보존하고 토큰만 갱신. */
  updateTokens: (accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  enterGuest: () => void;
  completeOnboarding: () => void;
  setExpoPushToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isGuest: false,
      onboardingCompleted: false,
      expoPushToken: null,
      setAuth: (accessToken, refreshToken) => {
        // 계정 전환/게스트→로그인 시 직전 세션의 서버 캐시가 gcTime 내 노출되는 것을 차단.
        purgeServerCache(queryClient);
        set({ accessToken, refreshToken, isAuthenticated: true, isGuest: false });
      },
      updateTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken, isAuthenticated: true, isGuest: false }),
      clearAuth: () => {
        // 로그아웃/세션 만료 시 이전 유저의 금융·개인정보 캐시를 남기지 않는다.
        purgeServerCache(queryClient);
        set({
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isGuest: false,
          expoPushToken: null,
        });
      },
      enterGuest: () => set({ isGuest: true }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      setExpoPushToken: (token) => set({ expoPushToken: token }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => secureStorage),
      version: 1,
      // SecureStore 에는 인증 플래그·토큰만 영속화(서버 User 비복제). 과거 버전이 저장한
      // `user` 키가 있어도 여기 화이트리스트 필드만 다시 기록되어 자연 소거된다.
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        isGuest: state.isGuest,
        onboardingCompleted: state.onboardingCompleted,
        expoPushToken: state.expoPushToken,
      }),
      // v0(기존 배포)이 저장한 `user`(서버 개인정보 복제본)를 마이그레이션 시 즉시 제거.
      migrate: (persisted) => {
        if (persisted && typeof persisted === 'object' && 'user' in persisted) {
          const copy = { ...(persisted as Record<string, unknown>) };
          delete copy.user;
          return copy;
        }
        return persisted;
      },
    },
  ),
);
