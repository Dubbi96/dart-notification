// SecureStore 는 네이티브 모듈 — 순수 로직 테스트에서는 인메모리 no-op 으로 대체.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { useAuthStore } from '@stores/authStore';
import { queryClient } from '@services/queryClient';

// 인증 스토어 상태 전이 + DAR-262(주체 전환 시 서버 캐시 전량 제거) 회귀 가드.
describe('stores/authStore', () => {
  beforeEach(() => {
    queryClient.clear();
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isGuest: false,
      onboardingCompleted: false,
      expoPushToken: null,
    });
  });

  it('setAuth: 토큰 저장 + 인증 플래그 + 게스트 해제', () => {
    useAuthStore.getState().enterGuest();
    useAuthStore.getState().setAuth('access-1', 'refresh-1');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
    expect(state.isAuthenticated).toBe(true);
    expect(state.isGuest).toBe(false);
  });

  it('setAuth: 직전 세션(게스트/타 유저)의 서버 캐시를 전량 제거한다(DAR-262)', () => {
    queryClient.setQueryData(['users', 'me'], { id: 'prev-user' });
    useAuthStore.getState().setAuth('access-1', 'refresh-1');
    expect(queryClient.getQueryData(['users', 'me'])).toBeUndefined();
  });

  it('updateTokens(토큰 회전): 같은 사용자이므로 캐시는 보존하고 토큰만 갱신', () => {
    useAuthStore.getState().setAuth('access-1', 'refresh-1');
    queryClient.setQueryData(['users', 'me'], { id: 'same-user' });

    useAuthStore.getState().updateTokens('access-2', 'refresh-2');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-2');
    expect(state.refreshToken).toBe('refresh-2');
    expect(state.isAuthenticated).toBe(true);
    expect(queryClient.getQueryData(['users', 'me'])).toEqual({ id: 'same-user' });
  });

  it('clearAuth: 토큰·인증·푸시토큰 초기화 + 이전 유저 캐시 제거', () => {
    useAuthStore.getState().setAuth('access-1', 'refresh-1');
    useAuthStore.getState().setExpoPushToken('ExponentPushToken[test]');
    queryClient.setQueryData(['watchlist'], [{ corpCode: '00126380' }]);

    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.expoPushToken).toBeNull();
    expect(queryClient.getQueryData(['watchlist'])).toBeUndefined();
  });

  it('enterGuest / completeOnboarding / setExpoPushToken 단순 전이', () => {
    useAuthStore.getState().enterGuest();
    expect(useAuthStore.getState().isGuest).toBe(true);

    useAuthStore.getState().completeOnboarding();
    expect(useAuthStore.getState().onboardingCompleted).toBe(true);

    useAuthStore.getState().setExpoPushToken('ExponentPushToken[abc]');
    expect(useAuthStore.getState().expoPushToken).toBe('ExponentPushToken[abc]');
  });
});
