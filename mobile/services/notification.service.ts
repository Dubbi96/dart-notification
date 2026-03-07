import { api } from './api';
import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type { Notification } from '@app-types/notification.types';

export const notificationService = {
  getList: (page = 1, limit = 20) =>
    api
      .get<ApiResponse<Notification[]>>('/notifications', { params: { page, limit } })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  markAsRead: (id: string) =>
    api.patch<ApiResponse<Notification>>(`/notifications/${id}/read`).then((r) => r.data.data),

  markAllAsRead: () =>
    api.patch<ApiResponse<void>>('/notifications/read-all').then((r) => r.data),

  remove: (id: string) =>
    api.delete<ApiResponse<void>>(`/notifications/${id}`).then((r) => r.data),
};
