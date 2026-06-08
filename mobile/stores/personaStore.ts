import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

import type { PhilosophyStyle } from '@app-types/style-comparison.types';

// 자동매매 persona 선택 상태(영속) — DAR-131 (P-D).
// 사용자가 고른 거장 철학 persona를 expo-secure-store에 영속한다(AsyncStorage 금지).
// ★ M11+ 정책: 선택은 '모의/선택'까지만. 실주문/자동매매 실행은 별도 사용자 명시 액션이며,
//   본 스토어는 선택 의사만 보존한다(자동 승인/실행 트리거 없음 — roles/plan-policy.md).

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

interface PersonaState {
  /** 선택한 모의운용 persona(거장 철학 style). 미선택이면 null. */
  selectedPersona: PhilosophyStyle | null;
  /** persona 선택/변경. */
  setPersona: (style: PhilosophyStyle) => void;
  /** 선택 해제. */
  clearPersona: () => void;
}

export const usePersonaStore = create<PersonaState>()(
  persist(
    (set) => ({
      selectedPersona: null,
      setPersona: (style) => set({ selectedPersona: style }),
      clearPersona: () => set({ selectedPersona: null }),
    }),
    {
      name: 'persona-selection-storage',
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
