import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import type { ColorScheme } from '@theme';

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

/** 글자 크기 배율(§9): 1.0 보통 / 1.25 크게 / 1.5 아주 크게 / null=시스템 따름 */
export type TextScaleOverride = 1.0 | 1.25 | 1.5 | null;

interface SettingsState {
  colorSchemeOverride: ColorScheme | 'system';
  setColorScheme: (scheme: ColorScheme | 'system') => void;
  textScaleOverride: TextScaleOverride;
  setTextScaleOverride: (scale: TextScaleOverride) => void;
  /**
   * Pro 출시 알림 사전 신청 여부(DAR-204) — 레거시.
   * 갭분석 W1 에서 서버 영속화(/users/pro-waitlist)로 전환되어 더 이상 정본이 아니다.
   * pro.tsx 가 1회 마이그레이션(로컬 true → 서버 등록 후 소거) 소스로만 읽는다.
   */
  proWaitlistOptIn: boolean;
  setProWaitlistOptIn: (optIn: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      colorSchemeOverride: 'system',
      setColorScheme: (scheme) => set({ colorSchemeOverride: scheme }),
      textScaleOverride: null,
      setTextScaleOverride: (scale) => set({ textScaleOverride: scale }),
      proWaitlistOptIn: false,
      setProWaitlistOptIn: (optIn) => set({ proWaitlistOptIn: optIn }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
