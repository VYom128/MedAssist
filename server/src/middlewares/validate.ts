import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { ApiError } from '../utils/ApiError.js';

export interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Validates body / query / params with Zod and replaces them with the parsed (clean) values.
 * On failure throws VALIDATION_ERROR with `details: [{ path: 'body.email', message }]`.
 */
export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    const issues: ValidationIssue[] = [];

    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ path: [key, ...issue.path].join('.'), message: issue.message });
        }
        continue;
      }

      if (key === 'query') {
        // req.query is a getter in some Express setups; redefine it instead of assigning.
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        req[key] = result.data;
      }
    }

    if (issues.length > 0) {
      next(ApiError.validation(issues));
      return;
    }
    next();
  };
