import { useMutation } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { authService } from '@services/auth.service';
import { useAuthStore } from '@stores/authStore';
import { router } from 'expo-router';

export function useKakaoLogin() {
  const { setAuth } = useAuthStore();
  return useMutation({
    mutationFn: authService.kakaoLogin,
    onSuccess: (data) => {
      setAuth(data.user, data.tokens.accessToken, data.tokens.refreshToken);
      SecureStore.setItemAsync('hasLoggedIn', 'true');
      if (data.isNewUser) {
        router.replace('/onboarding');
      } else {
        router.replace('/(tabs)/home');
      }
    },
  });
}

export function useLogout() {
  const { clearAuth } = useAuthStore();
  return useMutation({
    mutationFn: authService.logout,
    onSuccess: () => {
      clearAuth();
      router.replace('/auth/sign-in');
    },
  });
}
