import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as queueService from './service.js';
import type { QueueQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};

export async function getQueue(req: Request, res: Response) {
  const data = await queueService.getQueue(
    currentUser(req),
    req.query as unknown as QueueQuery,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function callNext(req: Request, res: Response) {
  const data = await queueService.callNext(currentUser(req), buildRequestMeta(req));
  return sendSuccess(res, {
    message: data ? 'Next patient called' : 'Nobody is waiting',
    data,
  });
}

export async function setPriority(req: Request, res: Response) {
  const data = await queueService.setPriority(
    currentUser(req),
    (req.params as { appointmentId: string }).appointmentId,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Priority updated', data });
}

export async function myPosition(req: Request, res: Response) {
  const data = await queueService.myPosition(currentUser(req));
  return sendSuccess(res, { data });
}

export async function getBoard(req: Request, res: Response) {
  const data = await queueService.getBoard((req.query as { key?: string }).key);
  return sendSuccess(res, { data });
}
