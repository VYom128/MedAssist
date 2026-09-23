import type { RequestHandler } from 'express';
import { AUDIT_ACTIONS, type Role } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditContext } from '../utils/requestContext.js';

/**
 * Allows only the given roles (deny by default, spec §2.2). Must run after `authenticate`.
 * Denials return 403 FORBIDDEN and are audited as `access.denied`.
 */
export function authorize(...roles: Role[]): RequestHandler {
  const allowed = new Set<Role>(roles);
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!allowed.has(req.user.role)) {
      await audit.record({
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        outcome: 'denied',
        ...auditContext(req),
        metadata: { reason: 'role', allowedRoles: roles },
      });
      throw ApiError.forbidden();
    }
    next();
  });
}
