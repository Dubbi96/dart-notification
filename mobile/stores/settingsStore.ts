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

interface SettingsState {
  colorSchemeOverride: ColorScheme | 'system';
  setColorScheme: (scheme: ColorScheme | 'system') => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      colorSchemeOverride: 'system',
      setColorScheme: (scheme) => set({ colorSchemeOverride: scheme }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
