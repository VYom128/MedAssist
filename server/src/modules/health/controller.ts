import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/ApiResponse.js';
import * as healthService from './service.js';

/** GET /health – always 200 while the API is up; `data.db` reports the database state. */
export async function getHealth(_req: Request, res: Response) {
  return sendSuccess(res, { message: 'Service healthy', data: healthService.getHealth() });
}
