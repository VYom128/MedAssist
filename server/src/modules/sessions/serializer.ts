import type { Types } from 'mongoose';
import type { SessionDoc } from './model.js';

type SessionLike = SessionDoc & { _id: Types.ObjectId; createdAt?: Date };

/** A session in the caller's own session list. `current` marks the caller's own login. */
export function toSessionView(s: SessionLike, currentFamily: string) {
  return {
    id: s._id.toString(),
    userAgent: s.userAgent ?? null,
    ip: s.ip ?? null,
    createdAt: s.createdAt ?? null,
    lastUsedAt: s.lastUsedAt ?? null,
    expiresAt: s.expiresAt,
    current: s.family === currentFamily,
  };
}
