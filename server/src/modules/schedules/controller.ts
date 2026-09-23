import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as schedulesService from './service.js';

const caller = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function getSchedule(req: Request, res: Response) {
  const data = await schedulesService.getSchedule(caller(req), idOf(req), buildRequestMeta(req));
  return sendSuccess(res, { data });
}

export async function replaceSchedule(req: Request, res: Response) {
  const data = await schedulesService.replaceSchedule(
    caller(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    message: data.warnings.length > 0 ? 'Schedule saved with warnings' : 'Schedule saved',
    data,
  });
}
