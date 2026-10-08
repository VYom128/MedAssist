import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as scheduleService from './schedule.service.js';
import * as followupsService from './service.js';
import type { ListFollowupsQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function createFollowup(req: Request, res: Response) {
  const data = await followupsService.createFollowup(
    currentUser(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Request sent', data });
}

export async function listFollowups(req: Request, res: Response) {
  const query = req.query as unknown as ListFollowupsQuery;
  const { items, meta } = await followupsService.listFollowups(
    currentUser(req),
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getFollowup(req: Request, res: Response) {
  const data = await followupsService.getFollowup(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function postMessage(req: Request, res: Response) {
  const data = await followupsService.postMessage(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Message sent', data });
}

export async function reviewFollowup(req: Request, res: Response) {
  const data = await followupsService.reviewFollowup(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Marked as in review', data });
}

export async function assignFollowup(req: Request, res: Response) {
  const data = await followupsService.assignFollowup(
    currentUser(req),
    idOf(req),
    (req.body as { doctorId: string }).doctorId,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Doctor assigned', data });
}

export async function scheduleFollowup(req: Request, res: Response) {
  const data = await scheduleService.scheduleFollowup(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Appointment booked', data });
}

export async function closeFollowup(req: Request, res: Response) {
  const data = await followupsService.finishFollowup(
    currentUser(req),
    idOf(req),
    'closed',
    (req.body as { reason: string }).reason,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Request closed', data });
}

export async function rejectFollowup(req: Request, res: Response) {
  const data = await followupsService.finishFollowup(
    currentUser(req),
    idOf(req),
    'rejected',
    (req.body as { reason: string }).reason,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Request rejected', data });
}
