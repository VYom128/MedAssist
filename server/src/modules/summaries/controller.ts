import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as summariesService from './service.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const paramsOf = (req: Request) => req.params as { id: string; summaryId: string };

export async function generateSummary(req: Request, res: Response) {
  const data = await summariesService.generateSummary(
    currentUser(req),
    paramsOf(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    statusCode: 201,
    message: 'Draft summary generated – review before approving',
    data,
  });
}

export async function getSummary(req: Request, res: Response) {
  const data = await summariesService.getSummary(
    currentUser(req),
    paramsOf(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function updateSummary(req: Request, res: Response) {
  const { id, summaryId } = paramsOf(req);
  const data = await summariesService.updateSummary(
    currentUser(req),
    id,
    summaryId,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Saved', data });
}

export async function approveSummary(req: Request, res: Response) {
  const { id, summaryId } = paramsOf(req);
  const data = await summariesService.approveSummary(
    currentUser(req),
    id,
    summaryId,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Summary approved', data });
}

export async function rejectSummary(req: Request, res: Response) {
  const { id, summaryId } = paramsOf(req);
  const data = await summariesService.rejectSummary(
    currentUser(req),
    id,
    summaryId,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Summary rejected', data });
}
