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
        >
      >,
    ) => notificationSettingsService.update(settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notificationSettings'] }),
  });
}
