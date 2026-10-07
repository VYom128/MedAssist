import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as followupsController from './controller.js';
import {
  assignFollowupSchema,
  createFollowupSchema,
  followupIdSchema,
  listFollowupsSchema,
  postMessageSchema,
  reasonSchema,
  scheduleFollowupSchema,
} from './validation.js';

/**
 * /follow-up-requests (spec §7.13, Phase 8). Patients create and follow their own; reception
 * triages all (admins read only); doctors handle the requests assigned to them. Which request a
 * caller may open is decided by policies/followupAccess (others → 404).
 */
const router = Router();
const { ADMIN, RECEPTIONIST, DOCTOR, PATIENT } = ROLES;

router.post(
  '/',
  authenticate,
  authorize(PATIENT),
  validate(createFollowupSchema),
  asyncHandler(followupsController.createFollowup),
);
router.get(
  '/',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR, PATIENT),
  validate(listFollowupsSchema),
  asyncHandler(followupsController.listFollowups),
);
router.get(
  '/:id',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR, PATIENT),
  validate(followupIdSchema),
  asyncHandler(followupsController.getFollowup),
);
router.post(
  '/:id/messages',
  authenticate,
  authorize(RECEPTIONIST, DOCTOR, PATIENT),
  validate(postMessageSchema),
  asyncHandler(followupsController.postMessage),
);
router.post(
  '/:id/review',
  authenticate,
  authorize(RECEPTIONIST, DOCTOR),
  validate(followupIdSchema),
  asyncHandler(followupsController.reviewFollowup),
);
router.post(
  '/:id/assign',
  authenticate,
  authorize(RECEPTIONIST),
  validate(assignFollowupSchema),
  asyncHandler(followupsController.assignFollowup),
);
router.post(
  '/:id/schedule',
  authenticate,
  authorize(RECEPTIONIST, DOCTOR),
  validate(scheduleFollowupSchema),
  asyncHandler(followupsController.scheduleFollowup),
);
router.post(
  '/:id/close',
  authenticate,
  authorize(RECEPTIONIST, DOCTOR, PATIENT),
  validate(reasonSchema),
  asyncHandler(followupsController.closeFollowup),
);
router.post(
  '/:id/reject',
  authenticate,
  authorize(RECEPTIONIST, DOCTOR),
  validate(reasonSchema),
  asyncHandler(followupsController.rejectFollowup),
);

export default router;
