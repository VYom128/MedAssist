import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as appointmentsController from './controller.js';
import {
  appointmentIdSchema,
  bookAppointmentSchema,
  calendarSchema,
  cancelSchema,
  listAppointmentsSchema,
  rescheduleSchema,
  updateAppointmentSchema,
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
  validate(bookAppointmentSchema),
  asyncHandler(appointmentsController.bookAppointment),
);
router.get(
  '/:id',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR, PATIENT),
  validate(appointmentIdSchema),
  asyncHandler(appointmentsController.getAppointment),
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

export default router;
