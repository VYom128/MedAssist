import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { logger } from '../../utils/logger.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as dashboards from './service.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};

/** Runs a dashboard and logs how long it took (spec §17: < 500 ms) – the name and time only. */
async function timed<T>(name: string, build: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const data = await build();
  const ms = Math.round(performance.now() - started);
  logger.info({ dashboard: name, ms }, 'Dashboard built');
  return data;
}

export async function admin(_req: Request, res: Response) {
  return sendSuccess(res, { data: await timed('admin', () => dashboards.adminDashboard()) });
}

export async function reception(_req: Request, res: Response) {
  return sendSuccess(res, {
    data: await timed('reception', () => dashboards.receptionDashboard()),
  });
}

export async function doctor(req: Request, res: Response) {
  const user = currentUser(req);
  return sendSuccess(res, { data: await timed('doctor', () => dashboards.doctorDashboard(user)) });
}

export async function lab(req: Request, res: Response) {
  const user = currentUser(req);
  return sendSuccess(res, { data: await timed('lab', () => dashboards.labDashboard(user)) });
}

export async function patient(req: Request, res: Response) {
  const user = currentUser(req);
  return sendSuccess(res, {
    data: await timed('patient', () => dashboards.patientDashboard(user, buildRequestMeta(req))),
  });
}
