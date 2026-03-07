import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';
import type { NotificationSettings } from '@app-types/user.types';

export const notificationSettingsService = {
  get: () =>
    api
      .get<ApiResponse<NotificationSettings>>('/notification-settings')
      .then((r) => r.data.data),

  update: (settings: Partial<Pick<NotificationSettings, 'disclosureTypes' | 'keywords' | 'isEnabled'>>) =>
    api
      .patch<ApiResponse<NotificationSettings>>('/notification-settings', settings)
      .then((r) => r.data.data),
};
