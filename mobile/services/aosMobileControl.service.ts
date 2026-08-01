import type { ApiResponse } from '@app-types/api.types';
import type {
  ActivateMobileKillSwitchInput,
  AosKillSwitchReceipt,
  AosOperatorBootstrap,
} from '@app-types/aos-operator.types';

import { api } from './api';

const STEP_UP_SCOPE = 'EMERGENCY_CONTROL' as const;

/** 모바일은 운영 상태 조회와 신규 진입 중단만 담당한다. 해제·Rule 편집은 Admin 전용이다. */
export const aosMobileControlService = {
  getBootstrap: () =>
    api
      .get<ApiResponse<AosOperatorBootstrap>>('/aos/operator/bootstrap')
      .then((response) => response.data.data),

  async activateNewEntryHalt(input: ActivateMobileKillSwitchInput) {
    const grant = await api
      .post<ApiResponse<{ token: string }>>('/aos/operator/auth/step-up', {
        password: input.password,
        scope: STEP_UP_SCOPE,
      })
      .then((response) => response.data.data);

    return api
      .post<ApiResponse<AosKillSwitchReceipt>>(
        '/aos/operator/emergency/kill-switch',
        {
          command: 'ACTIVATE',
          scope: 'NEW_ENTRY',
          mode: 'FULL_HALT',
          reason: input.reason,
          correlationId: input.correlationId,
        },
        { headers: { 'x-aos-step-up-token': grant.token } },
      )
      .then((response) => response.data.data);
  },
};
