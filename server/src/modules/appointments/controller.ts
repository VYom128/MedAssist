import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as bookingService from './booking.service.js';
import * as appointmentsService from './service.js';
import * as slotsService from './slots.service.js';
import * as statusService from './status.service.js';
import type {
  AvailabilityQuery,
  CalendarQuery,
  ListAppointmentsQuery,
  SlotsQuery,
} from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

// ---- /doctors/:id/slots and /availability --------------------------------------------------

export async function getSlots(req: Request, res: Response) {
  const data = await slotsService.getSlots(
    currentUser(req),
    idOf(req),
    req.query as unknown as SlotsQuery,
  );
  return sendSuccess(res, { message: 'Slots fetched', data });
}

export async function getAvailability(req: Request, res: Response) {
  const data = await slotsService.getAvailability(
    currentUser(req),
    idOf(req),
    req.query as unknown as AvailabilityQuery,
  );
  return sendSuccess(res, { data });
}

// ---- /appointments -------------------------------------------------------------------------

export async function listAppointments(req: Request, res: Response) {
  const query = req.query as unknown as ListAppointmentsQuery;
  const { items, meta } = await appointmentsService.listAppointments(
    currentUser(req),
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getCalendar(req: Request, res: Response) {
  const data = await appointmentsService.getCalendar(
    currentUser(req),
    req.query as unknown as CalendarQuery,
  );
  return sendSuccess(res, { data });
}

export async function getAppointment(req: Request, res: Response) {
  const data = await appointmentsService.getAppointment(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function bookAppointment(req: Request, res: Response) {
  const data = await bookingService.bookAppointment(
    currentUser(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Appointment booked', data });
}

export async function updateAppointment(req: Request, res: Response) {
  const data = await appointmentsService.updateAppointment(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Appointment updated', data });
}

export async function rescheduleAppointment(req: Request, res: Response) {
  const data = await bookingService.rescheduleAppointment(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Appointment rescheduled', data });
}

export async function cancelAppointment(req: Request, res: Response) {
  const data = await statusService.cancelAppointment(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Appointment cancelled', data });
}
