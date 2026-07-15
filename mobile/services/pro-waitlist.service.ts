import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';
import type { ProWaitlistStatus } from '@app-types/user.types';

/**
 * Pro 출시 알림 사전신청 API(갭분석 W1).
 * 기존 로컬 보관(useSettingsStore.proWaitlistOptIn)을 서버 영속화로 전환 —
 * 신청(POST)·철회(DELETE) 모두 서버측에서 멱등이라 재시도에 안전하다.
 */
export const proWaitlistService = {
  /** 본인 사전신청 여부 조회 */
  getStatus: () =>
    api
      .get<ApiResponse<ProWaitlistStatus>>('/users/pro-waitlist')
      .then((r) => r.data.data),

  /** 사전신청 등록(멱등 — 재호출해도 1행 유지) */
  join: () =>
    api
      .post<ApiResponse<ProWaitlistStatus>>('/users/pro-waitlist')
      .then((r) => r.data.data),

  /** 사전신청 철회(멱등 — 미신청이어도 no-op) */
  withdraw: () =>
    api
      .delete<ApiResponse<ProWaitlistStatus>>('/users/pro-waitlist')
      .then((r) => r.data.data),
};
