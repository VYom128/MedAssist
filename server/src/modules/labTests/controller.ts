import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as labTestsService from './service.js';
import type { ListLabTestsQuery } from './validation.js';

const caller = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listLabTests(req: Request, res: Response) {
  const query = req.query as unknown as ListLabTestsQuery;
  const { items, meta } = await labTestsService.listLabTests(
    caller(req),
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getLabTest(req: Request, res: Response) {
  return sendSuccess(res, { data: await labTestsService.getLabTest(caller(req), idOf(req)) });
}

export async function createLabTest(req: Request, res: Response) {
  const data = await labTestsService.createLabTest(caller(req), req.body, buildRequestMeta(req));
  return sendSuccess(res, { statusCode: 201, message: 'Lab test created', data });
}

export async function updateLabTest(req: Request, res: Response) {
  const data = await labTestsService.updateLabTest(
    caller(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Lab test updated', data });
}

export async function deactivateLabTest(req: Request, res: Response) {
  const data = await labTestsService.setLabTestActive(
    caller(req),
    idOf(req),
    false,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Lab test deactivated', data });
}

export async function activateLabTest(req: Request, res: Response) {
  const data = await labTestsService.setLabTestActive(
    caller(req),
    idOf(req),
    true,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Lab test activated', data });
}
