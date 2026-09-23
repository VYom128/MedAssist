import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as portalService from './portal.service.js';
import * as patientsService from './service.js';
import type { CheckDuplicateQuery, ListPatientsQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listPatients(req: Request, res: Response) {
  const query = req.query as unknown as ListPatientsQuery;
  const { items, meta } = await patientsService.listPatients(
    currentUser(req),
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function checkDuplicate(req: Request, res: Response) {
  const data = await patientsService.checkDuplicate(req.query as unknown as CheckDuplicateQuery);
  return sendSuccess(res, { data });
}

export async function createPatient(req: Request, res: Response) {
  const data = await patientsService.createPatient(
    currentUser(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Patient registered', data });
}

export async function getPatient(req: Request, res: Response) {
  const data = await patientsService.getPatient(currentUser(req), idOf(req), buildRequestMeta(req));
  return sendSuccess(res, { data });
}

export async function updatePatient(req: Request, res: Response) {
  const data = await patientsService.updatePatient(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Patient updated', data });
}

export async function updateClinicalProfile(req: Request, res: Response) {
  const data = await patientsService.updateClinicalProfile(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Clinical profile updated', data });
}

export async function deactivatePatient(req: Request, res: Response) {
  const data = await patientsService.setPatientActive(
    currentUser(req),
    idOf(req),
    false,
    (req.body as { reason: string }).reason,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Patient deactivated', data });
}

export async function activatePatient(req: Request, res: Response) {
  const data = await patientsService.setPatientActive(
    currentUser(req),
    idOf(req),
    true,
    (req.body as { reason: string }).reason,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Patient activated', data });
}

export async function getMyRecord(req: Request, res: Response) {
  const data = await portalService.getMyRecord(currentUser(req), buildRequestMeta(req));
  return sendSuccess(res, { data });
}

export async function updateMyRecord(req: Request, res: Response) {
  const data = await portalService.updateMyRecord(
    currentUser(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Your details were updated', data });
}

export async function listPendingLinks(req: Request, res: Response) {
  const { items, meta } = await portalService.listPendingLinks(parsePagination(req.query));
  return sendSuccess(res, { data: items, meta });
}

export async function confirmLink(req: Request, res: Response) {
  const data = await portalService.confirmLink(
    currentUser(req),
    idOf(req),
    (req.body as { userId: string }).userId,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Portal account linked', data });
}

export async function rejectLink(req: Request, res: Response) {
  const { userId, reason } = req.body as { userId: string; reason: string };
  const data = await portalService.rejectLink(
    currentUser(req),
    idOf(req),
    userId,
    reason,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    message: 'Link rejected; a separate patient record was created',
    data,
  });
}

export async function inviteToPortal(req: Request, res: Response) {
  const data = await portalService.inviteToPortal(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Portal invitation sent', data });
}
