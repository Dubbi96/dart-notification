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
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      colorSchemeOverride: 'system',
      setColorScheme: (scheme) => set({ colorSchemeOverride: scheme }),
      textScaleOverride: null,
      setTextScaleOverride: (scale) => set({ textScaleOverride: scale }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
