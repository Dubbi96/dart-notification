import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';
import type { AuthResponse, KakaoAuthPayload } from '@app-types/auth.types';

export const authService = {
  kakaoLogin: (payload: KakaoAuthPayload) =>
    api.post<ApiResponse<AuthResponse>>('/auth/kakao', payload).then((r) => r.data.data),

  refresh: (refreshToken: string) =>
    api
      .post<ApiResponse<{ accessToken: string; refreshToken: string; expiresIn: number }>>(
        '/auth/refresh',
        { refreshToken },
      )
      .then((r) => r.data.data),

  logout: () => api.post('/auth/logout'),
};
