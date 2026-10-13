import type { Types } from 'mongoose';

/** A notification as its recipient sees it (spec §7.17) – never anyone else's. */
export interface NotificationLike {
  _id: Types.ObjectId;
  type: string;
  priority?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
  data?: Record<string, unknown> | null;
  readAt?: Date | null;
  createdAt?: Date;
}

export function toView(n: NotificationLike) {
  return {
    id: n._id.toString(),
    type: n.type,
    priority: n.priority ?? 'normal',
    title: n.title,
    body: n.body ?? '',
    link: n.link ?? null,
    data: n.data ?? {},
    readAt: n.readAt ?? null,
    createdAt: n.createdAt ?? null,
  };
}

export type NotificationView = ReturnType<typeof toView>;
