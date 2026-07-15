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

  logout: (deviceToken?: string) =>
    api.post('/auth/logout', { deviceToken }),

  getMe: () =>
    api.get<ApiResponse<{ id: string; email: string; name: string | null }>>('/users/me').then((r) => r.data.data),

  updateMe: (payload: { name: string }) =>
    api
      .patch<ApiResponse<{ id: string; email: string; name: string | null; updatedAt: string }>>('/users/me', payload)
      .then((r) => r.data.data),

  // 회원 탈퇴 — 계정·개인 데이터 영구 삭제 + 서버측 refresh 토큰 전부 폐기 (갭분석 W3)
  deleteMe: () =>
    api.delete<ApiResponse<{ deleted: boolean }>>('/users/me').then((r) => r.data.data),
};
