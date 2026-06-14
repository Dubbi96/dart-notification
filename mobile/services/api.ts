import axios from 'axios';
import { Platform } from 'react-native';
import { useAuthStore } from '@stores/authStore';

import { createSingleFlight } from './singleFlight';

const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
// 앱↔백엔드 연결의 단일 진실원천. 진단 UI(연결 실패 안내·dev 인디케이터)도 이 값을 표기한다.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || `http://${DEV_HOST}:3000/api`;

// 연결 실패 판별 순수 함수는 RN 비의존 모듈로 분리(결정론적 단위 검증용) — 여기서 재노출한다.
export { isConnectionError, isNotFoundError } from './connectionError';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - attach access token
api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// 진행중인 /auth/refresh 를 캐시하는 single-flight 게이트 — 동시 401 이 N 개의 refresh 를
// 일으켜 토큰 회전을 서로 무효화(강제 로그아웃)하는 것을 막는다(DAR-203). 새 access token 을 반환한다.
const refreshAccessToken = createSingleFlight<string>();

async function performTokenRefresh(refreshToken: string): Promise<string> {
  const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
    refreshToken,
  });
  const refreshData = data.data;
  // 인터셉터 실행 시점의 최신 store 액션을 사용(클로저 캡처 stale 회피).
  // 토큰 회전은 같은 사용자 세션이므로 updateTokens(캐시 보존). setAuth 는 로그인 전용(캐시 비움, DAR-262).
  useAuthStore.getState().updateTokens(refreshData.accessToken, refreshData.refreshToken);
  return refreshData.accessToken;
}

// Response interceptor - handle 401 and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // error.config 는 요청 단계 밖(인터셉터 throw 등)에서 발생한 에러에는 없을 수 있다 → TypeError 가드.
    if (originalRequest && error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const { refreshToken, clearAuth, isGuest } = useAuthStore.getState();
      if (!refreshToken) {
        if (!isGuest) clearAuth();
        return Promise.reject(error);
      }

      try {
        // 동시 401 은 모두 같은 refresh Promise 를 await — 실제 /auth/refresh 는 1 회만 호출된다.
        const accessToken = await refreshAccessToken(() => performTokenRefresh(refreshToken));
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        if (!useAuthStore.getState().isGuest) clearAuth();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
