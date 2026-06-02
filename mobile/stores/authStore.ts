import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import type { User } from '@app-types/auth.types';

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

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  onboardingCompleted: boolean;
  expoPushToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  enterGuest: () => void;
  completeOnboarding: () => void;
  setExpoPushToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isGuest: false,
      onboardingCompleted: false,
      expoPushToken: null,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true, isGuest: false }),
      clearAuth: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isGuest: false, expoPushToken: null }),
      enterGuest: () => set({ isGuest: true }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      setExpoPushToken: (token) => set({ expoPushToken: token }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
