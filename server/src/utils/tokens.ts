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

/**
 * Verifies an access JWT (signature, algorithm, expiry).
 * @throws jwt.TokenExpiredError / jwt.JsonWebTokenError
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, config.auth.accessSecret, { algorithms: [ALGORITHM] });
  if (typeof decoded === 'string') throw new jwt.JsonWebTokenError('invalid payload');
  const { sub, role, sid, iat, exp } = decoded as Partial<AccessTokenClaims>;
  if (!sub || !role || !sid || !iat || !exp) throw new jwt.JsonWebTokenError('missing claims');
  return { sub, role, sid, iat, exp };
}

/** URL-safe random token (refresh tokens, reset links). */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Tokens are stored only as this hash, never in plain text. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
