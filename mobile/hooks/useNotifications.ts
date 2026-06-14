import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@services/notification.service';

import type { NotificationType } from '@app-types/notification.types';

// DAR-161: type 필터를 queryKey에 포함해 세그먼트 전환 시 캐시를 분리한다.
export function useNotifications(options?: { enabled?: boolean; type?: NotificationType }) {
  const type = options?.type;

  return useInfiniteQuery({
    queryKey: ['notifications', type ?? 'ALL'],
    queryFn: ({ pageParam = 1 }) => notificationService.getList(pageParam, 20, type),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.page < (lastPage.meta.totalPages ?? 1)) return lastPage.meta.page + 1;
      return undefined;
    },
    initialPageParam: 1,
    enabled: options?.enabled ?? true,
  });
}

// DAR-216: 미읽음 건수 단일 진실원천(React Query). 탭 배지(_layout)와 홈 헤더 배지가
// 이 경량 쿼리(page=1, limit=1)를 직접 구독한다 — Zustand 복제 금지(CLAUDE.md).
// queryKey가 ['notifications'] 접두사를 공유하므로 markAsRead/markAllAsRead 및 푸시 수신 시
// invalidateQueries(['notifications'])로 목록·배지가 함께 갱신돼 항상 일치한다.
export function useUnreadCount(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationService.getList(1, 1),
    select: (res) => res.meta.unreadCount ?? 0,
    enabled: options?.enabled ?? true,
  });
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
