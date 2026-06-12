import { useMutation, useQuery } from '@tanstack/react-query';
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

export function useMe() {
  const { isAuthenticated, setAuth, clearAuth, accessToken, refreshToken } = useAuthStore();
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: async () => {
      try {
        const data = await authService.getMe();
        if (data && accessToken && refreshToken) {
          setAuth(data, accessToken, refreshToken);
        }
        return data;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          clearAuth();
          router.replace('/auth/sign-in');
        }
        throw err;
      }
    },
    enabled: isAuthenticated,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5분
  });
}

export function useLogout() {
  const { clearAuth, expoPushToken } = useAuthStore();

  const handleLogout = () => {
    clearAuth();
    router.replace('/auth/sign-in');
  };

  return useMutation({
    mutationFn: () => authService.logout(expoPushToken ?? undefined),
    onSuccess: handleLogout,
    onError: handleLogout,
  });
}
