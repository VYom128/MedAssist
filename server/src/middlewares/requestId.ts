import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const HEADER = 'X-Request-Id';
// Accept a caller-supplied id only if it is short and safe to echo into headers and logs.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, req.id);
  next();
};
