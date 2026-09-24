import { Router } from 'express';
import { ROLE_VALUES, ROLES } from '../../config/constants.js';
import { authenticate, optionalAuthenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as appointmentsController from '../appointments/controller.js';
import { availabilitySchema, slotsSchema } from '../appointments/validation.js';
import * as leavesController from '../leaves/controller.js';
import { createLeaveSchema, leaveIdSchema, listLeavesSchema } from '../leaves/validation.js';
import * as schedulesController from '../schedules/controller.js';
import { doctorScheduleSchema, replaceScheduleSchema } from '../schedules/validation.js';
import * as doctorsController from './controller.js';
import {
  createDoctorSchema,
  doctorIdSchema,
  listDoctorsSchema,
  updateDoctorSchema,
} from './validation.js';

const { ADMIN, DOCTOR, RECEPTIONIST } = ROLES;

/**
 * /doctors (spec §7.6). `:id` is the doctor's User id. Schedule and leave routes are declared
 * here (not as a router mounted at `/:id`) so the route inventory test can list them. "Own"
 * checks for doctors are in policies/doctorAccess.ts.
 */
const router = Router();

router.get(
  '/',
  optionalAuthenticate,
  validate(listDoctorsSchema),
  asyncHandler(doctorsController.listDoctors),
);
router.get(
  '/:id',
  optionalAuthenticate,
  validate(doctorIdSchema),
  asyncHandler(doctorsController.getDoctor),
);
router.post(
  '/',
  authenticate,
  authorize(ADMIN),
  validate(createDoctorSchema),
  asyncHandler(doctorsController.createDoctor),
);
router.patch(
  '/:id',
  authenticate,
  authorize(ADMIN, DOCTOR),
  validate(updateDoctorSchema),
  asyncHandler(doctorsController.updateDoctor),
);

// Weekly schedule (spec §6.9)
router.get(
  '/:id/schedule',
  authenticate,
  authorize(ADMIN, DOCTOR, RECEPTIONIST),
  validate(doctorScheduleSchema),
  asyncHandler(schedulesController.getSchedule),
);
router.put(
  '/:id/schedule',
  authenticate,
  authorize(ADMIN, DOCTOR),
  validate(replaceScheduleSchema),
  asyncHandler(schedulesController.replaceSchedule),
);

// Leave (spec §6.10, §4.13)
router.get(
  '/:id/leaves',
  authenticate,
  authorize(ADMIN, DOCTOR, RECEPTIONIST),
  validate(listLeavesSchema),
  asyncHandler(leavesController.listLeaves),
);
router.post(
  '/:id/leaves',
  authenticate,
  authorize(ADMIN, DOCTOR),
  validate(createLeaveSchema),
  asyncHandler(leavesController.createLeave),
);
router.post(
  '/:id/leaves/:leaveId/cancel',
  authenticate,
  authorize(ADMIN, DOCTOR),
  validate(leaveIdSchema),
  asyncHandler(leavesController.cancelLeave),
);

// Free slots and per-day availability (spec §7.6, §8.1): any logged-in user.
router.get(
  '/:id/slots',
  authenticate,
  authorize(...ROLE_VALUES),
  validate(slotsSchema),
  asyncHandler(appointmentsController.getSlots),
);
router.get(
  '/:id/availability',
  authenticate,
  authorize(...ROLE_VALUES),
  validate(availabilitySchema),
  asyncHandler(appointmentsController.getAvailability),
);

export default router;
