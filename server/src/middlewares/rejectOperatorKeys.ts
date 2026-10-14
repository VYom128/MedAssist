import type { RequestHandler } from 'express';
import { ApiError } from '../utils/ApiError.js';

/**
 * NoSQL-injection guard (spec §10.3): rejects a request whose body or query has a key that starts
 * with `$` (a MongoDB operator, e.g. `?email[$ne]=x`) or contains `.` (a dotted path), at any
 * depth – before any route sees it. Zod would strip most of them anyway; this makes the rule
 * explicit for every route. 400 VALIDATION_ERROR naming the key's path, never its value.
 */

const MAX_DEPTH = 20;
const isForbidden = (key: string) => key.startsWith('$') || key.includes('.');

/** The path of the first forbidden key in `value` ("body.filter.$ne"), or null. */
export function findOperatorKey(value: unknown, path: string, depth = 0): string | null {
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findOperatorKey(value[i], `${path}.${i}`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (isForbidden(key)) return `${path}.${key}`;
    const hit = findOperatorKey(child, `${path}.${key}`, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export const rejectOperatorKeys: RequestHandler = (req, _res, next) => {
  const field = findOperatorKey(req.body, 'body') ?? findOperatorKey(req.query, 'query');
  if (!field) {
    next();
    return;
  }
  next(
    ApiError.validation('Invalid request', [
      { field, message: 'Keys may not start with "$" or contain "."' },
    ]),
  );
};
