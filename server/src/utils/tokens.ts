import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '../config/constants.js';
import { config } from '../config/env.js';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  sid: string;
  iat: number;
  exp: number;
}

const ALGORITHM = 'HS256';

/** Signs a short-lived access JWT with claims `sub`, `role`, `sid`, `iat` (spec §10.1). */
export function signAccessToken(payload: { sub: string; role: Role; sid: string }): string {
  return jwt.sign({ role: payload.role, sid: payload.sid }, config.auth.accessSecret, {
    algorithm: ALGORITHM,
    subject: payload.sub,
    expiresIn: config.auth.accessExpiresIn,
  });
}

/** Why an access token was rejected: `expired` (the client should refresh) or `invalid`. */
export class AccessTokenError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(reason === 'expired' ? 'Access token expired' : 'Invalid access token');
    this.name = 'AccessTokenError';
  }
}

/**
 * Verifies an access JWT (signature, HS256 only, expiry, required claims).
 * @throws AccessTokenError with reason 'expired' or 'invalid'
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.auth.accessSecret, { algorithms: [ALGORITHM] });
  } catch (err) {
    throw new AccessTokenError(err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid');
  }
  if (typeof decoded === 'string') throw new AccessTokenError('invalid');
  const { sub, role, sid, iat, exp } = decoded as Partial<AccessTokenClaims>;
  if (!sub || !role || !sid || !iat || !exp) throw new AccessTokenError('invalid');
  return { sub, role, sid, iat, exp };
}

const OPAQUE_TOKEN_BYTES = 64;

/** 64 random bytes as base64url: refresh tokens and reset links (spec §10.1). */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex digest. Opaque tokens are stored only as this hash, never in plain text. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
