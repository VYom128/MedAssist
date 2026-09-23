import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/ApiResponse.js';
import * as healthService from './service.js';

/** 200 when the DB is connected, 503 otherwise – body shape is the same so the UI can show both. */
export async function getHealth(_req: Request, res: Response) {
  const health = healthService.getHealth();
  const ok = health.db === 'connected';
  return sendSuccess(res, {
    statusCode: ok ? 200 : 503,
    message: ok ? 'Service healthy' : 'Database unavailable',
    data: health,
  });
}
