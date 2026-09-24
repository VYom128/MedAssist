import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as labOrdersService from './service.js';
import type { ListLabOrdersQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const params = (req: Request) => req.params as { id: string; itemId?: string };

export async function listLabOrders(req: Request, res: Response) {
  const query = req.query as unknown as ListLabOrdersQuery;
  const { items, meta } = await labOrdersService.listLabOrders(
    currentUser(req),
    query,
    parsePagination(query),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.getLabOrder(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function createLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.createLabOrder(
    currentUser(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    statusCode: 201,
    message:
      data.status === 'draft'
        ? 'Lab order saved – it is sent when you sign the note'
        : 'Lab order placed',
    data,
  });
}

export async function updateLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.updateDraftOrder(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Lab order updated', data });
}

export async function discardLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.discardDraftOrder(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Draft lab order discarded', data });
}

export async function cancelLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.cancelLabOrder(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Lab order cancelled', data });
}

export async function cancelLabOrderItem(req: Request, res: Response) {
  const { id, itemId } = params(req);
  const data = await labOrdersService.cancelLabOrderItem(
    currentUser(req),
    id,
    itemId!,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Test cancelled', data });
}
