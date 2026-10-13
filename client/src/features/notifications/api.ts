import { apiSlice } from '../../app/apiSlice';
import type { NotificationPriority, NotificationType } from '../../constants/notifications';
import type { ApiSuccess, PageMeta } from '../../utils/http';

/** Server shapes from server/src/modules/notifications (spec §6.24, §7.17). */

export interface NotificationItem {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  /** No clinical details (spec §10.3). */
  title: string;
  body: string;
  /** Path in this app for the recipient's role, or null. */
  link: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  meta: PageMeta & { unreadCount: number };
}

export interface NotificationListParams {
  page?: number;
  limit?: number;
  unread?: boolean;
}

/** Socket payloads (Phase 10). */
export interface NotificationNewEvent {
  notification: NotificationItem;
  unreadCount: number;
}
export interface NotificationReadEvent {
  ids: string[] | 'all';
  unreadCount: number;
}

export const NOTIFICATION_LIST = { type: 'Notification' as const, id: 'LIST' };
export const NOTIFICATION_COUNT = { type: 'NotificationCount' as const, id: 'ME' };

/** Unread badges show "99+" above 99. */
export const formatUnread = (n: number) => (n > 99 ? '99+' : String(n));

export const notificationsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listNotifications: build.query<NotificationPage, NotificationListParams>({
      query: ({ page = 1, limit = 20, unread }) => ({
        url: '/notifications',
        params: { page, limit, ...(unread ? { unread: 'true' } : {}) },
      }),
      transformResponse: (res: ApiSuccess<NotificationItem[]>) => ({
        items: res.data,
        meta: res.meta as unknown as NotificationPage['meta'],
      }),
      providesTags: [NOTIFICATION_LIST],
    }),
    getUnreadCount: build.query<number, void>({
      query: () => ({ url: '/notifications/unread-count' }),
      transformResponse: (res: ApiSuccess<{ unreadCount: number }>) => res.data.unreadCount,
      providesTags: [NOTIFICATION_COUNT],
    }),
    markNotificationRead: build.mutation<{ unreadCount: number }, string>({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'POST' }),
      transformResponse: (res: ApiSuccess<{ unreadCount: number }>) => res.data,
      async onQueryStarted(_id, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled.catch(() => ({ data: null }));
        if (data) {
          dispatch(
            notificationsApi.util.upsertQueryData('getUnreadCount', undefined, data.unreadCount),
          );
        }
      },
      invalidatesTags: [NOTIFICATION_LIST],
    }),
    markAllNotificationsRead: build.mutation<void, void>({
      query: () => ({ url: '/notifications/read-all', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        // The badge clears at once; a failure puts it back.
        const patch = dispatch(
          notificationsApi.util.updateQueryData('getUnreadCount', undefined, () => 0),
        );
        await queryFulfilled.catch(() => patch.undo());
      },
      invalidatesTags: [NOTIFICATION_LIST],
    }),
  }),
});

export const {
  useListNotificationsQuery,
  useLazyListNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationsApi;
