import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@services/notification.service';
import { useNotificationStore } from '@stores/notificationStore';

export function useNotifications(options?: { enabled?: boolean }) {
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);

  const query = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam = 1 }) => notificationService.getList(pageParam),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
    enabled: options?.enabled ?? true,
  });

  useEffect(() => {
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
