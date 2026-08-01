import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
        router.replace('/(tabs)/signals');
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

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authService.updateMe,
    // PATCH /users/me 응답이 갱신된 User(SSOT 상위집합)를 담으므로 즉시 캐시에 반영해
    // 홈 헤더 인사말 등 useMe 소비 화면이 재조회 없이 새 이름을 보게 하고,
    // invalidate 로 백그라운드 재검증까지 걸어 GET 전용 필드 드리프트를 방지한다(UXR-18/D-6).
    onSuccess: (updated) => {
      queryClient.setQueryData(['users', 'me'], updated);
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    },
  });
}

export function useDeleteAccount() {
  const { clearAuth } = useAuthStore();

  return useMutation({
    mutationFn: () => authService.deleteMe(),
    // 성공 시에만 로컬 세션을 정리한다 — 실패 시 계정이 남아 있으므로 세션 유지 후
    // 화면에서 에러 안내(onError 콜백)를 노출한다.
    onSuccess: async () => {
      // 탈퇴 = 계정 소멸: 재로그인 시 신규 유저 온보딩이 다시 보이도록 환영 플래그도 제거
      await SecureStore.deleteItemAsync('hasLoggedIn').catch(() => {});
      // clearAuth 가 토큰·푸시토큰 초기화 + 서버 캐시(purgeServerCache) 전량 제거를 수행
      clearAuth();
      router.replace('/auth/sign-in');
    },
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
