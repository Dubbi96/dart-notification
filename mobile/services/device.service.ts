import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';

export const deviceService = {
  register: (deviceToken: string, platform: 'ios' | 'android') =>
    api
      .post<ApiResponse<{ id: string }>>('/devices/register', { deviceToken, platform })
      .then((r) => r.data.data),

  unregister: (id: string) =>
    api.delete<ApiResponse<void>>(`/devices/${id}`).then((r) => r.data),
};
