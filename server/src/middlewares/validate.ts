import type { RequestHandler } from 'express';
import { ZodError, type z } from 'zod';

export interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Validates `req.params`, `req.query` and `req.body` with Zod and replaces them with the parsed
 * values, so unknown fields are stripped and coercions/defaults apply.
 * On failure calls `next(zodError)`; errorHandler formats it as 400 VALIDATION_ERROR.
 * Issue paths are prefixed with the request part (e.g. `body.email`).
 */
export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    const issues: z.core.$ZodIssue[] = [];

    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        issues.push(...result.error.issues.map((i) => ({ ...i, path: [key, ...i.path] })));
        continue;
      }
      // Express 4 allows reassigning req.query; revisit this if we upgrade to Express 5
      // (where req.query is a getter).
      req[key] = result.data as never;
    }

    if (issues.length > 0) {
      next(new ZodError(issues));
      return;
    }
    next();
  };
