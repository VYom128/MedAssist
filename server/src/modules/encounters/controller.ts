import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as encountersService from './service.js';
import type { ListEncountersQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listEncounters(req: Request, res: Response) {
  const query = req.query as unknown as ListEncountersQuery;
  const { items, meta } = await encountersService.listEncounters(
    currentUser(req),
    query,
    parsePagination(query),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getEncounter(req: Request, res: Response) {
  const data = await encountersService.getEncounter(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function getEncounterForAppointment(req: Request, res: Response) {
  const data = await encountersService.getEncounterForAppointment(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function updateEncounter(req: Request, res: Response) {
  const data = await encountersService.updateEncounter(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Saved', data });
}
