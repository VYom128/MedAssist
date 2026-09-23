import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as doctorsService from './service.js';
import type { ListDoctorsQuery } from './validation.js';

const caller = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listDoctors(req: Request, res: Response) {
  const query = req.query as unknown as ListDoctorsQuery;
  const { items, meta } = await doctorsService.listDoctors(req.user, query, parsePagination(query));
  return sendSuccess(res, { data: items, meta });
}

export async function getDoctor(req: Request, res: Response) {
  return sendSuccess(res, { data: await doctorsService.getDoctor(req.user, idOf(req)) });
}

export async function createDoctor(req: Request, res: Response) {
  const data = await doctorsService.createDoctor(caller(req), req.body, buildRequestMeta(req));
  return sendSuccess(res, {
    statusCode: 201,
    message: 'Doctor created. A link to set their password has been emailed.',
    data,
  });
}

export async function updateDoctor(req: Request, res: Response) {
  const data = await doctorsService.updateDoctor(
    caller(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Doctor profile updated', data });
}
