import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as settingsService from './service.js';

export async function getPublicSettings(_req: Request, res: Response) {
  return sendSuccess(res, { data: await settingsService.getPublicSettings() });
}

export async function getSettings(_req: Request, res: Response) {
  return sendSuccess(res, { data: await settingsService.getAdminSettings() });
}

export async function updateSettings(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const data = await settingsService.updateSettings(req.user, req.body, buildRequestMeta(req));
  return sendSuccess(res, { message: 'Settings updated', data });
}
