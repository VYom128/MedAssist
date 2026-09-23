import type { RequestHandler } from 'express';
import { CSRF_HEADER } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * CSRF protection for cookie-authenticated endpoints (spec §10.1). Browsers cannot add a custom
 * header to a cross-site form post, and CORS blocks it for other origins' scripts.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (req.get(CSRF_HEADER.name) !== CSRF_HEADER.value) {
    next(ApiError.forbidden(`Missing ${CSRF_HEADER.name} header`));
    return;
  }
  next();
};
