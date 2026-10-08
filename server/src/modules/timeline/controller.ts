import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as timelineService from './service.js';
import type { TimelineQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};

export async function getPatientTimeline(req: Request, res: Response) {
  const { items, meta } = await timelineService.getTimeline(
    currentUser(req),
    (req.params as { id: string }).id,
    req.query as unknown as TimelineQuery,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getMyTimeline(req: Request, res: Response) {
  const { items, meta } = await timelineService.getMyTimeline(
    currentUser(req),
    req.query as unknown as TimelineQuery,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}
