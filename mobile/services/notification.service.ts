import { api } from './api';
import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type { Notification, NotificationCategory } from '@app-types/notification.types';

export const notificationService = {
  // DAR-430: category 미지정 시 전체 조회, 지정 시 해당 카테고리(3 버킷)만.
  getList: (page = 1, limit = 20, category?: NotificationCategory) =>
    api
      .get<ApiResponse<Notification[]>>('/notifications', {
        params: { page, limit, ...(category ? { category } : {}) },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  markAsRead: (id: string) =>
    api.patch<ApiResponse<Notification>>(`/notifications/${id}/read`).then((r) => r.data.data),

  markAllAsRead: () =>
    api.patch<ApiResponse<void>>('/notifications/read-all').then((r) => r.data),

  remove: (id: string) =>
    api.delete<ApiResponse<void>>(`/notifications/${id}`).then((r) => r.data),
};
