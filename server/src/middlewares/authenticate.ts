import type { RequestHandler } from 'express';
import { isValidObjectId } from 'mongoose';
import { ERROR_CODES } from '../config/constants.js';
import { Session } from '../modules/sessions/model.js';
import { User } from '../modules/users/model.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AccessTokenError, verifyAccessToken, type AccessTokenClaims } from '../utils/tokens.js';

const sessionRevoked = () =>
  new ApiError(401, 'Your session has ended. Please log in again.', ERROR_CODES.SESSION_REVOKED);

function readClaims(header: string | undefined): AccessTokenClaims {
  const match = header?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  if (!match?.[1]) throw ApiError.unauthorized();
  try {
    return verifyAccessToken(match[1]);
  } catch (err) {
    if (err instanceof AccessTokenError && err.reason === 'expired') {
      throw new ApiError(401, 'Access token expired', ERROR_CODES.TOKEN_EXPIRED);
    }
    throw ApiError.unauthorized('Invalid access token');
  }
}

/**
 * A session is live if it is active, or if it was only rotated (a refresh in this or another
 * tab) and its family still has an active session. Logout and every other revocation revoke the
 * whole family, so tokens of rotated sessions stop working at the same moment.
 */
async function isSessionLive(session: {
  family: string;
  revokedAt?: Date | null;
  revokedReason?: string | null;
  expiresAt: Date;
}): Promise<boolean> {
  const now = new Date();
  if (!session.revokedAt) return session.expiresAt > now;
  if (session.revokedReason !== 'rotated') return false;
  return Boolean(
    await Session.exists({ family: session.family, revokedAt: null, expiresAt: { $gt: now } }),
  );
}

/**
 * Resolves an access token to the caller (spec §10.1). Beyond the JWT it checks: the session
 * (`sid`) is live → 401 SESSION_REVOKED; the user is active → 403 ACCOUNT_INACTIVE; the token is
 * not older than the last password change → 401 SESSION_REVOKED; unless allowed, a pending
 * password change → 403 PASSWORD_CHANGE_REQUIRED. Used by `authenticate` and the Socket.IO
 * handshake, so both apply the same rules.
 */
export async function resolveAccessToken(
  token: string | undefined,
  { allowPendingPasswordChange = false }: { allowPendingPasswordChange?: boolean } = {},
): Promise<AuthUser> {
  const claims = readClaims(token ? `Bearer ${token}` : undefined);
  if (!isValidObjectId(claims.sub) || !isValidObjectId(claims.sid)) {
    throw ApiError.unauthorized('Invalid access token');
  }

  const [user, session] = await Promise.all([
    User.findById(claims.sub).lean(),
    Session.findById(claims.sid, {
      user: 1,
      family: 1,
      revokedAt: 1,
      revokedReason: 1,
      expiresAt: 1,
    }).lean(),
  ]);

  if (!session || !session.user.equals(claims.sub) || !(await isSessionLive(session))) {
    throw sessionRevoked();
  }
  if (!user || user.role !== claims.role) throw ApiError.unauthorized('Invalid access token');
  if (!user.isActive) {
    throw new ApiError(403, 'This account has been deactivated', ERROR_CODES.ACCOUNT_INACTIVE);
  }
  // passwordChangedAt is stored 1 s early, so tokens issued right after the change pass.
  if (user.passwordChangedAt && claims.iat * 1000 < user.passwordChangedAt.getTime()) {
    throw sessionRevoked();
  }
  if (user.mustChangePassword && !allowPendingPasswordChange) {
    throw new ApiError(
      403,
      'You must change your password before continuing',
      ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
    );
  }

  return {
    id: user._id.toString(),
    role: user.role,
    sessionId: claims.sid,
    sessionFamily: session.family,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
    // Only a confirmed link grants access to the record (spec §4.4): a self-registered user
    // waiting for reception's identity check points at a Patient but must not see it.
    patientId: user.patientLinkStatus === 'linked' ? (user.patient?.toString() ?? null) : null,
  };
}

/** Verifies the Bearer access token (`resolveAccessToken`) and sets `req.user`. */
function createAuthenticate({
  allowPendingPasswordChange,
}: {
  allowPendingPasswordChange: boolean;
}) {
  return asyncHandler(async (req, _res, next) => {
    const match = req.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
    if (!match?.[1]) throw ApiError.unauthorized();
    req.user = await resolveAccessToken(match[1], { allowPendingPasswordChange });
    next();
  });
}

/** Requires a valid access token. Users with `mustChangePassword` get 403 PASSWORD_CHANGE_REQUIRED. */
export const authenticate: RequestHandler = createAuthenticate({
  allowPendingPasswordChange: false,
});

/**
 * Like `authenticate`, but lets users who must change their password through. Only for
 * GET /auth/me, POST /auth/change-password and POST /auth/logout.
 */
export const authenticateAllowingPasswordChange: RequestHandler = createAuthenticate({
  allowPendingPasswordChange: true,
});

/**
 * For public endpoints that show more to some roles (e.g. `?includeInactive=true` for admins).
 * No Authorization header → anonymous (`req.user` unset). A header with a bad or expired token →
 * the usual 401, so the client refreshes instead of silently getting the public view. A user who
 * must change their password is treated as anonymous.
 */
export const optionalAuthenticate: RequestHandler = (req, res, next) => {
  if (!req.get('authorization')) {
    next();
    return;
  }
  authenticateAllowingPasswordChange(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (req.user?.mustChangePassword) req.user = undefined;
    next();
  });
};
