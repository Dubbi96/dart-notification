import { create } from 'zustand';
import type { ColorScheme } from '@theme';

interface SettingsState {
  // 'system' follows OS setting; otherwise manual override
  colorSchemeOverride: ColorScheme | 'system';
  setColorScheme: (scheme: ColorScheme | 'system') => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  colorSchemeOverride: 'system',
  setColorScheme: (scheme) => set({ colorSchemeOverride: scheme }),
}));
