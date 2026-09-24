import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as prescriptionsService from './service.js';
import type { ListPrescriptionsQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listPrescriptions(req: Request, res: Response) {
  const query = req.query as unknown as ListPrescriptionsQuery;
  const { items, meta } = await prescriptionsService.listPrescriptions(
    currentUser(req),
    query,
    parsePagination(query),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getPrescription(req: Request, res: Response) {
  const data = await prescriptionsService.getPrescription(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function cancelPrescription(req: Request, res: Response) {
  const data = await prescriptionsService.cancelPrescription(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Prescription cancelled', data });
}

export async function reissuePrescription(req: Request, res: Response) {
  const data = await prescriptionsService.reissuePrescription(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    statusCode: 201,
    message: 'Prescription cancelled – edit the new draft and issue it',
    data,
  });
}

export async function issuePrescription(req: Request, res: Response) {
  const data = await prescriptionsService.issuePrescription(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Prescription issued', data });
}
