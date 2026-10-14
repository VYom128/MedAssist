import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/ApiResponse.js';
import * as healthService from './service.js';

/**
 * GET /health – always 200 while the API is up (Render's health check); `data.db` reports the
 * database state and `data.commit` the deployed commit. `data.client` echoes the caller's own
 * address as the API sees it and the X-Forwarded-For chain, so the proxy setup (TRUST_PROXY,
 * D197/D201) can be checked after a deploy – nobody else's address is ever shown.
 */
export async function getHealth(req: Request, res: Response) {
  const forwarded = req.headers['x-forwarded-for'];
  return sendSuccess(res, {
    message: 'Service healthy',
    data: {
      ...healthService.getHealth(),
      client: {
        ip: req.ip ?? null,
        forwardedFor: Array.isArray(forwarded) ? forwarded.join(', ') : (forwarded ?? null),
      },
    },
  });
}
