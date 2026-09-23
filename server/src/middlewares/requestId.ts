import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const HEADER = 'X-Request-Id';
// Reuse a caller-supplied id only if it is short and safe to echo into headers and logs
// (prevents log/header injection); otherwise generate one.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Sets `req.id` (incoming X-Request-Id or a new UUID) and echoes it as the X-Request-Id header. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, req.id);
  next();
};
