import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as servicesService from './service.js';
import type { ListServicesQuery } from './validation.js';

const admin = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listServices(req: Request, res: Response) {
  const query = req.query as unknown as ListServicesQuery;
  const { items, meta } = await servicesService.listServices(
    req.user,
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getService(req: Request, res: Response) {
  return sendSuccess(res, { data: await servicesService.getService(req.user, idOf(req)) });
}

export async function createService(req: Request, res: Response) {
  const data = await servicesService.createService(admin(req), req.body, buildRequestMeta(req));
  return sendSuccess(res, { statusCode: 201, message: 'Service created', data });
}

export async function updateService(req: Request, res: Response) {
  const data = await servicesService.updateService(
    admin(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Service updated', data });
}

export async function deactivateService(req: Request, res: Response) {
  const data = await servicesService.deactivateService(
    admin(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Service deactivated', data });
}

export async function activateService(req: Request, res: Response) {
  const data = await servicesService.activateService(admin(req), idOf(req), buildRequestMeta(req));
  return sendSuccess(res, { message: 'Service activated', data });
}
