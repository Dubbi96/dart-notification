import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

import type { PhilosophyStyle } from '@app-types/style-comparison.types';

// persona 비교 강조 상태(영속) — DAR-131 (P-D) / DAR-205 어휘 약화.
// 사용자가 비교 화면에서 강조할 거장 철학 persona를 expo-secure-store에 영속한다(AsyncStorage 금지).
// ★ DAR-205: 이 값은 표시용 하이라이트(비교 강조)일 뿐 신호 큐레이션/홈/추천을 바꾸지 않는다.
//   '선택→결과 반영' 오약속을 피하려 화면 카피는 '비교 강조'로 약화한다(personaDisplay PERSONA_EMPHASIS).
// ★ M11+ 정책: 실주문/자동매매 실행은 별도 사용자 명시 액션이며, 본 스토어는 자동 승인/실행
//   트리거가 없다(roles/plan-policy.md). 함수명(setPersona 등)은 호환 위해 유지.

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
  /** 비교에서 강조 중인 persona(거장 철학 style). 미강조이면 null. */
  selectedPersona: PhilosophyStyle | null;
  /** persona 강조 설정/변경. */
  setPersona: (style: PhilosophyStyle) => void;
  /** 강조 해제. */
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
