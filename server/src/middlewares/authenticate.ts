import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { isValidObjectId } from 'mongoose';
import { ERROR_CODES } from '../config/constants.js';
import { Session } from '../modules/sessions/model.js';
import { User } from '../modules/users/model.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyAccessToken, type AccessTokenClaims } from '../utils/tokens.js';

const sessionRevoked = () =>
  new ApiError(401, 'Your session has ended. Please log in again.', ERROR_CODES.SESSION_REVOKED);

function readClaims(header: string | undefined): AccessTokenClaims {
  const match = header?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  if (!match?.[1]) throw ApiError.unauthorized();
  try {
    return verifyAccessToken(match[1]);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
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
 * Verifies the Bearer access token and sets `req.user` (spec §10.1). Beyond the JWT it checks,
 * per request, that the user is still active, the token is newer than the last password change,
 * and the session (`sid`) has not been revoked. So logout, password change and deactivation
 * take effect immediately.
 */
function createAuthenticate({
  allowPendingPasswordChange,
}: {
  allowPendingPasswordChange: boolean;
}) {
  return asyncHandler(async (req, _res, next) => {
    const claims = readClaims(req.get('authorization'));
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

    if (!user || user.role !== claims.role) throw ApiError.unauthorized('Invalid access token');
    if (!user.isActive) {
      throw new ApiError(403, 'This account has been deactivated', ERROR_CODES.ACCOUNT_INACTIVE);
    }
    if (
      user.passwordChangedAt &&
      claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      throw sessionRevoked();
    }
    if (!session || !session.user.equals(user._id) || !(await isSessionLive(session))) {
      throw sessionRevoked();
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      sid: claims.sid,
      sessionFamily: session.family,
      firstName: user.firstName,
      lastName: user.lastName,
      patientId: user.patient?.toString() ?? null,
    };

    if (user.mustChangePassword && !allowPendingPasswordChange) {
      throw new ApiError(
        403,
        'You must change your password before continuing',
        ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
      );
    }
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
