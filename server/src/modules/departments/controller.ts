import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as departmentsService from './service.js';
import type { ListDepartmentsQuery } from './validation.js';

const admin = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listDepartments(req: Request, res: Response) {
  const query = req.query as unknown as ListDepartmentsQuery;
  const { items, meta } = await departmentsService.listDepartments(
    req.user,
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getDepartment(req: Request, res: Response) {
  return sendSuccess(res, { data: await departmentsService.getDepartment(req.user, idOf(req)) });
}

export async function createDepartment(req: Request, res: Response) {
  const data = await departmentsService.createDepartment(
    admin(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Department created', data });
}

export async function updateDepartment(req: Request, res: Response) {
  const data = await departmentsService.updateDepartment(
    admin(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Department updated', data });
}

export async function deactivateDepartment(req: Request, res: Response) {
  const data = await departmentsService.deactivateDepartment(
    admin(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Department deactivated', data });
}

export async function activateDepartment(req: Request, res: Response) {
  const data = await departmentsService.activateDepartment(
    admin(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Department activated', data });
}
