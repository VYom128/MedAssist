import { Types } from 'mongoose';
import { unreadCount } from '../../services/notification.service.js';
import { emitNotificationRead } from '../../socket/emitter.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { Notification } from './model.js';
import { toView, type NotificationLike } from './serializer.js';
import type { ListNotificationsQuery } from './validation.js';

/**
 * The caller's own notifications (spec §7.17). Every query is scoped to `recipient = user.id`,
 * so another user's notification id is simply not found (404). Reading is not audited (no
 * clinical content); after a read the user's other tabs get `notification.read` with the count.
 */

const mine = (user: AuthUser) => ({ recipient: new Types.ObjectId(user.id) });

/** GET /notifications – newest first; `unread` = only unread. Meta adds `unreadCount`. */
export async function listNotifications(
  user: AuthUser,
  query: ListNotificationsQuery,
  { page, limit, skip }: Pagination,
) {
  const filter = { ...mine(user), ...(query.unread ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<NotificationLike[]>(),
    Notification.countDocuments(filter),
    unreadCount(user.id),
  ]);
  return {
    items: items.map(toView),
    meta: { ...buildMeta({ page, limit, total }), unreadCount: unread },
  };
}

/** GET /notifications/unread-count */
export async function getUnreadCount(user: AuthUser) {
  return { unreadCount: await unreadCount(user.id) };
}

/** POST /notifications/:id/read – own only (404 otherwise); idempotent. */
export async function markRead(user: AuthUser, id: string) {
  const n = await Notification.findOneAndUpdate(
    { _id: new Types.ObjectId(id), ...mine(user) },
    [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
    { new: true },
  ).lean<NotificationLike>();
  if (!n) throw ApiError.notFound('Notification not found');
  const count = await unreadCount(user.id);
  emitNotificationRead(user.id, { ids: [id], unreadCount: count });
  return { notification: toView(n), unreadCount: count };
}

/** POST /notifications/read-all – marks the caller's unread notifications read. */
export async function markAllRead(user: AuthUser) {
  const res = await Notification.updateMany(
    { ...mine(user), readAt: null },
    { $set: { readAt: new Date() } },
  );
  emitNotificationRead(user.id, { ids: 'all', unreadCount: 0 });
  return { updated: res.modifiedCount, unreadCount: 0 };
}
