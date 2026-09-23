import type { RequestHandler } from 'express';
import { ApiError } from '../utils/ApiError.js';

/** Catch-all for unmatched routes: 404 NOT_FOUND "Route not found: METHOD /path". */
export const notFound: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`));
};
