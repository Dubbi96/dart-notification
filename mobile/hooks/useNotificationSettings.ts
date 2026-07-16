import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationSettingsService } from '@services/notification-settings.service';
import type { NotificationSettings } from '@app-types/user.types';

export function useNotificationSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['notificationSettings'],
    queryFn: notificationSettingsService.get,
    enabled: options?.enabled,
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
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
    ) => notificationSettingsService.update(settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notificationSettings'] }),
  });
}
