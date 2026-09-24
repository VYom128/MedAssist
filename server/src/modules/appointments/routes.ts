import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { patientBookingLimiter } from '../../middlewares/rateLimiters.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as encountersController from '../encounters/controller.js';
import * as appointmentsController from './controller.js';
import {
  appointmentIdSchema,
  bookAppointmentSchema,
  calendarSchema,
  cancelSchema,
  listAppointmentsSchema,
  rescheduleSchema,
  updateAppointmentSchema,
  walkInSchema,
} from './validation.js';

/**
 * /appointments (spec §7.8). Status changes are action endpoints. Which appointments a caller
 * sees is decided by policies/appointmentAccess (doctor and patient: own; others → 404).
 * Slots and availability are under /doctors/:id (doctors/routes.ts).
 */
const router = Router();
const { ADMIN, RECEPTIONIST, DOCTOR, PATIENT } = ROLES;

router.get(
  '/',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR, PATIENT),
  validate(listAppointmentsSchema),
  asyncHandler(appointmentsController.listAppointments),
);
router.get(
  '/calendar',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR),
  validate(calendarSchema),
  asyncHandler(appointmentsController.getCalendar),
);
router.post(
  '/',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, PATIENT),
  patientBookingLimiter,
  validate(bookAppointmentSchema),
  asyncHandler(appointmentsController.bookAppointment),
);
router.post(
  '/walk-in',
  authenticate,
  authorize(RECEPTIONIST),
  validate(walkInSchema),
  asyncHandler(appointmentsController.walkIn),
);
router.get(
  '/:id',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR, PATIENT),
  validate(appointmentIdSchema),
  asyncHandler(appointmentsController.getAppointment),
);
// The clinical note of the doctor's own appointment (consult workspace; spec §4.7).
router.get(
  '/:id/encounter',
  authenticate,
  authorize(DOCTOR),
  validate(appointmentIdSchema),
  asyncHandler(encountersController.getEncounterForAppointment),
);
router.patch(
  '/:id',
  authenticate,
  authorize(ADMIN, RECEPTIONIST),
  validate(updateAppointmentSchema),
  asyncHandler(appointmentsController.updateAppointment),
);
router.post(
  '/:id/reschedule',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, PATIENT),
  patientBookingLimiter,
  validate(rescheduleSchema),
  asyncHandler(appointmentsController.rescheduleAppointment),
);
router.post(
  '/:id/cancel',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR, PATIENT),
  validate(cancelSchema),
  asyncHandler(appointmentsController.cancelAppointment),
);

// Status actions (spec §5.1). Doctors act on their own appointments only (policy → 404).
const action = (
  path: string,
  roles: readonly (typeof ROLES)[keyof typeof ROLES][],
  handler: Parameters<typeof asyncHandler>[0],
) =>
  router.post(
    `/:id/${path}`,
    authenticate,
    authorize(...roles),
    validate(appointmentIdSchema),
    asyncHandler(handler),
  );
action('check-in', [RECEPTIONIST], appointmentsController.checkIn);
action('start', [DOCTOR], appointmentsController.startConsultation);
action('complete', [DOCTOR], appointmentsController.completeConsultation);
action('no-show', [RECEPTIONIST], appointmentsController.markNoShow);
action('undo-no-show', [RECEPTIONIST], appointmentsController.undoNoShow);

export default router;
