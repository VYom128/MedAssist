import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import { AUTH_LIMITS, type SessionRevokeReason } from '../../config/constants.js';
import { config } from '../../config/env.js';
import { generateOpaqueToken, hashToken } from '../../utils/tokens.js';
import { Session } from './model.js';

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

const DAY_MS = 86_400_000;
const MAX_REPLACEMENT_HOPS = 10;

const newExpiry = (now: Date) => new Date(now.getTime() + config.auth.refreshTtlDays * DAY_MS);

/**
 * Starts a session (login/register) or continues a family (rotation).
 * @returns the session id, its expiry and the raw refresh token (only ever sent in the cookie).
 */
export async function createSession(
  userId: Types.ObjectId | string,
  client: ClientInfo,
  family: string = randomUUID(),
) {
  const refreshToken = generateOpaqueToken();
  const now = new Date();
  const expiresAt = newExpiry(now);
  const session = await Session.create({
    user: userId,
    refreshTokenHash: hashToken(refreshToken),
    family,
    userAgent: client.userAgent,
    ip: client.ip,
    lastUsedAt: now,
    expiresAt,
  });
  return { sessionId: session._id.toString(), refreshToken, expiresAt };
}

export type RotationResult =
  /** Normal rotation: new session + new refresh token for the cookie. */
  | { kind: 'rotated'; userId: string; sessionId: string; refreshToken: string; expiresAt: Date }
  /** A just-rotated token reused within the grace window: access token only, cookie unchanged. */
  | { kind: 'grace'; userId: string; sessionId: string }
  /** An old rotated token reused after the grace window: the family has been revoked. */
  | { kind: 'reuse'; userId: string; family: string }
  /** Unknown, expired or logged-out token. */
  | { kind: 'invalid' };

/**
 * Rotates a refresh token (spec §10.1).
 *
 * Concurrency: the replacement session is inserted first, then the old one is revoked with a
 * conditional update that also sets `replacedBy`. Only one caller wins; the others fall through
 * to the grace path and find the replacement already present. Losers delete their unused insert.
 */
export async function rotateRefreshToken(
  rawToken: string,
  client: ClientInfo,
): Promise<RotationResult> {
  const hash = hashToken(rawToken);
  const now = new Date();
  let current = await Session.findOne({ refreshTokenHash: hash }).lean();
  if (!current) return { kind: 'invalid' };

  if (!current.revokedAt) {
    if (current.expiresAt <= now) return { kind: 'invalid' };

    const next = await createSession(current.user, client, current.family);
    const won = await Session.findOneAndUpdate(
      { _id: current._id, revokedAt: null },
      {
        $set: {
          revokedAt: now,
          revokedReason: 'rotated',
          replacedBy: next.sessionId,
          lastUsedAt: now,
        },
      },
    );
    if (won) return { kind: 'rotated', userId: current.user.toString(), ...next };

    // Lost the race to a parallel refresh with the same token.
    await Session.deleteOne({ _id: next.sessionId });
    current = await Session.findById(current._id).lean();
    if (!current) return { kind: 'invalid' };
  }

  if (current.revokedReason !== 'rotated') return { kind: 'invalid' };

  const revokedAt = current.revokedAt?.getTime() ?? 0;
  if (now.getTime() - revokedAt <= AUTH_LIMITS.refreshGraceSeconds * 1000) {
    // Follow the rotation chain to the live session.
    let live = current;
    for (let hop = 0; hop < MAX_REPLACEMENT_HOPS && live.replacedBy; hop++) {
      const nextSession = await Session.findById(live.replacedBy).lean();
      if (!nextSession) break;
      live = nextSession;
    }
    if (!live.revokedAt && live.expiresAt > now) {
      return { kind: 'grace', userId: live.user.toString(), sessionId: live._id.toString() };
    }
    return { kind: 'invalid' };
  }

  // A rotated token presented again after the grace window: assume theft, kill the family.
  await revokeFamily(current.family, 'reuse_detected');
  return { kind: 'reuse', userId: current.user.toString(), family: current.family };
}

/**
 * Revokes every active session in a rotation family (one login on one device).
 * @returns how many sessions were revoked.
 */
export async function revokeFamily(family: string, reason: SessionRevokeReason): Promise<number> {
  const res = await Session.updateMany(
    { family, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return res.modifiedCount;
}

/**
 * Revokes all active sessions of a user, optionally keeping one login (the caller's family).
 * @returns how many sessions were revoked.
 */
export async function revokeAllForUser(
  userId: Types.ObjectId | string,
  reason: SessionRevokeReason,
  exceptFamily?: string,
): Promise<number> {
  const res = await Session.updateMany(
    {
      user: userId,
      revokedAt: null,
      ...(exceptFamily ? { family: { $ne: exceptFamily } } : {}),
    },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return res.modifiedCount;
}

/** Active sessions of a user, optionally not counting one login (family). */
export function countActiveForUser(userId: Types.ObjectId | string, exceptFamily?: string) {
  return Session.countDocuments({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
    ...(exceptFamily ? { family: { $ne: exceptFamily } } : {}),
  });
}

/** The user's active (not revoked, not expired) sessions, most recently used first. */
export function listActiveSessions(userId: Types.ObjectId | string) {
  return Session.find({ user: userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
}

/** One active session of this user, or null. */
export function findActiveSession(userId: string, sessionId: string) {
  return Session.findOne({
    _id: sessionId,
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean();
}
