import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { SESSION_REVOKE_REASONS } from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/**
 * One refresh-token session per login (spec §6.4). Only the SHA-256 of the token is stored.
 * Rotation revokes the old session with reason 'rotated' and points `replacedBy` at the new one;
 * all sessions from one login share a `family`.
 */
const sessionSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    userAgent: String,
    ip: String,
    lastUsedAt: Date,
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: SESSION_REVOKE_REASONS },
    replacedBy: { type: ObjectId, ref: 'Session' },
  },
  { timestamps: true },
);

// TTL: MongoDB removes sessions once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionDoc = InferSchemaType<typeof sessionSchema>;

export const Session: Model<SessionDoc> =
  (mongoose.models.Session as Model<SessionDoc> | undefined) ??
  mongoose.model<SessionDoc>('Session', sessionSchema);
