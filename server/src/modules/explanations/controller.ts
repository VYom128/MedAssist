import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as explanationsService from './service.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function explainPrescription(req: Request, res: Response) {
  const data = await explanationsService.explainPrescription(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function explainFollowUp(req: Request, res: Response) {
  const data = await explanationsService.explainFollowUp(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function prescriptionFeedback(req: Request, res: Response) {
  const data = await explanationsService.prescriptionFeedback(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Thank you for your feedback', data });
}
