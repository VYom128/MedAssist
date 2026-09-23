import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as leavesService from './service.js';
import type { ListLeavesQuery } from './validation.js';

const caller = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const params = (req: Request) => req.params as { id: string; leaveId: string };

export async function listLeaves(req: Request, res: Response) {
  const query = req.query as unknown as ListLeavesQuery;
  const { items, meta } = await leavesService.listLeaves(
    caller(req),
    params(req).id,
    query,
    parsePagination(query),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function createLeave(req: Request, res: Response) {
  const data = await leavesService.createLeave(
    caller(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Leave recorded', data });
}

export async function cancelLeave(req: Request, res: Response) {
  const { id, leaveId } = params(req);
  const data = await leavesService.cancelLeave(caller(req), id, leaveId, buildRequestMeta(req));
  return sendSuccess(res, { message: 'Leave cancelled', data });
}
