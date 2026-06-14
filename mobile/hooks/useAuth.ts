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
      setAuth(data.tokens.accessToken, data.tokens.refreshToken);
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
  const { isAuthenticated, clearAuth } = useAuthStore();
  return useQuery({
    queryKey: ['users', 'me'],
    // 순수 조회: 서버 User 는 이 쿼리의 data 가 SSOT. 토큰 변동이 없으므로 setAuth 로
    // 토큰을 재기록(불필요한 SecureStore I/O)하거나 authStore 에 복제하지 않는다(DAR-262).
    queryFn: async () => {
      try {
        return await authService.getMe();
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
