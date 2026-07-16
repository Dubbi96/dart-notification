import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';
import type { NotificationSettings } from '@app-types/user.types';

export const notificationSettingsService = {
  get: () =>
    api
      .get<ApiResponse<NotificationSettings>>('/notification-settings')
      .then((r) => r.data.data),

  update: (
    settings: Partial<
      Pick<
        NotificationSettings,
        | 'disclosureTypes'
        | 'keywords'
        | 'isEnabled'
        | 'signalPushEnabled'
        | 'exitPushEnabled'
        | 'thesisPushEnabled'
        | 'tradePushEnabled'
        | 'opsPushEnabled'
        // 갭분석 W7: 관심종목 급변동 알림 토글(기본 OFF).
        | 'priceMovePushEnabled'
        // DAR-514(Wave A): 신규 2계열 토글(예약) + 일일 푸시 캡.
        | 'editionPushEnabled'
        | 'digestPushEnabled'
        | 'dailyPushCap'
      >
    >,
  ) =>
    api
      .patch<ApiResponse<NotificationSettings>>('/notification-settings', settings)
      .then((r) => r.data.data),
};
