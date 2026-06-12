import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@services/notification.service';
import { useNotificationStore } from '@stores/notificationStore';

import type { NotificationType } from '@app-types/notification.types';

// DAR-161: type 필터를 queryKey에 포함해 세그먼트 전환 시 캐시를 분리한다.
// type 미지정(전체)일 때 unreadCount/unreadByType(둘 다 사용자 전체 기준)로 탭 배지를 동기화.
export function useNotifications(options?: { enabled?: boolean; type?: NotificationType }) {
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const type = options?.type;

  const query = useInfiniteQuery({
    queryKey: ['notifications', type ?? 'ALL'],
    queryFn: ({ pageParam = 1 }) => notificationService.getList(pageParam, 20, type),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
    enabled: options?.enabled ?? true,
  });

  useEffect(() => {
    // unreadCount는 타입 필터와 무관하게 사용자 전체 미읽음 → 어떤 세그먼트에서든 탭 배지 일관.
    const count = query.data?.pages[0]?.meta.unreadCount ?? 0;
    setUnreadCount(count);
  }, [query.data]);

  return query;
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationService.markAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationService.markAllAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
