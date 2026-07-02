import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { notificationService } from '@services/notification.service';
import { NOTIFICATION_CATEGORY } from '@app-types/notification.types';

import type { PaginationMeta } from '@app-types/api.types';
import type { Notification, NotificationCategory } from '@app-types/notification.types';

// DAR-430: category 필터를 queryKey에 포함해 세그먼트 전환 시 캐시를 분리한다.
export function useNotifications(options?: {
  enabled?: boolean;
  category?: NotificationCategory;
}) {
  const category = options?.category;

  return useInfiniteQuery({
    queryKey: ['notifications', category ?? 'ALL'],
    queryFn: ({ pageParam = 1 }) => notificationService.getList(pageParam, 20, category),
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

// ── UXR-16(D-2): 읽음 처리 낙관적 업데이트 ──────────────────────────────────
// ['notifications'] 접두 캐시 두 형태를 함께 갱신한다:
//  - 무한 쿼리(목록, 카테고리별 'ALL'|'disclosure'|…): InfiniteData<NotificationPage>
//  - 경량 unread-count 쿼리(단일 응답, select 이전 원본): NotificationPage
// onMutate에서 스냅샷을 떠 즉시 반영하고, onError 시 전량 롤백, onSettled에서
// invalidate로 서버 진실과 최종 정합을 맞춘다.
type NotificationPage = { data: Notification[]; meta: PaginationMeta };
type NotificationsCache = InfiniteData<NotificationPage> | NotificationPage;

const ZERO_UNREAD_BY_CATEGORY: Record<NotificationCategory, number> = {
  disclosure: 0,
  signal: 0,
  trade: 0,
};

/** meta 의 미읽음 계열 카운트를 1 감소(카테고리 지정 시 해당 버킷도 함께). */
function decrementUnreadMeta(meta: PaginationMeta, category?: NotificationCategory): PaginationMeta {
  const next: PaginationMeta = { ...meta };
  if (typeof next.unreadCount === 'number') {
    next.unreadCount = Math.max(0, next.unreadCount - 1);
  }
  if (category && next.unreadByCategory) {
    next.unreadByCategory = {
      ...next.unreadByCategory,
      [category]: Math.max(0, (next.unreadByCategory[category] ?? 0) - 1),
    };
  }
  return next;
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationService.markAsRead,
    // 낙관적 갱신: 행 하이라이트·배지가 서버 왕복을 기다리지 않고 즉시 읽음으로 바뀐다.
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueriesData<NotificationsCache>({
        queryKey: ['notifications'],
      });

      // 대상 알림을 캐시에서 찾아 미읽음 여부·카테고리 파악(못 찾으면 onSettled invalidate로 보정).
      let target: Notification | undefined;
      for (const [, cache] of previous) {
        if (!cache || !('pages' in cache)) continue;
        for (const page of cache.pages) {
          target = page.data.find((n) => n.id === id);
          if (target) break;
        }
        if (target) break;
      }
      const wasUnread = target ? !target.isRead : false;
      const category = target ? NOTIFICATION_CATEGORY[target.type] : undefined;

      queryClient.setQueriesData<NotificationsCache>({ queryKey: ['notifications'] }, (old) => {
        if (!old) return old;
        if ('pages' in old) {
          // 이 캐시(카테고리 필터 포함)에 대상이 미읽음으로 존재할 때만 행·카운트를 갱신.
          const hasUnreadHere = old.pages.some((p) =>
            p.data.some((n) => n.id === id && !n.isRead),
          );
          if (!hasUnreadHere) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
              meta: decrementUnreadMeta(page.meta, category),
            })),
          };
        }
        // unread-count 경량 캐시: 대상이 미읽음이었을 때만 감소.
        if (!wasUnread) return old;
        return { ...old, meta: decrementUnreadMeta(old.meta, category) };
      });

      return { previous };
    },
    // 실패 시 스냅샷 전량 롤백 — 미읽음 상태가 정직하게 복원된다.
    onError: (_error, _id, context) => {
      context?.previous?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationService.markAllAsRead,
    // 낙관적 갱신: 전체 행 읽음 + 미읽음 카운트(전체·카테고리별) 0 — 스낵바 문구와 화면이 일치.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueriesData<NotificationsCache>({
        queryKey: ['notifications'],
      });

      queryClient.setQueriesData<NotificationsCache>({ queryKey: ['notifications'] }, (old) => {
        if (!old) return old;
        if ('pages' in old) {
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((n) => (n.isRead ? n : { ...n, isRead: true })),
              meta: {
                ...page.meta,
                unreadCount: 0,
                unreadByCategory: { ...ZERO_UNREAD_BY_CATEGORY },
              },
            })),
          };
        }
        return {
          ...old,
          meta: { ...old.meta, unreadCount: 0, unreadByCategory: { ...ZERO_UNREAD_BY_CATEGORY } },
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      context?.previous?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
