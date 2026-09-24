import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { boardLimiter } from '../../middlewares/rateLimiters.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as queueController from './controller.js';
import { boardSchema, prioritySchema, queueSchema } from './validation.js';

/**
 * /queue (spec §7.9). The board is public but needs the kiosk key (and is rate-limited); it
 * shows tokens, doctor names and rooms only.
 */
const router = Router();
const { ADMIN, RECEPTIONIST, DOCTOR, PATIENT } = ROLES;

router.get(
  '/',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR),
  validate(queueSchema),
  asyncHandler(queueController.getQueue),
);
router.get('/board', boardLimiter, validate(boardSchema), asyncHandler(queueController.getBoard));
router.get(
  '/my-position',
  authenticate,
  authorize(PATIENT),
  asyncHandler(queueController.myPosition),
);
router.post('/call-next', authenticate, authorize(DOCTOR), asyncHandler(queueController.callNext));
router.post(
  '/:appointmentId/priority',
  authenticate,
  authorize(RECEPTIONIST),
  validate(prioritySchema),
  asyncHandler(queueController.setPriority),
);

export default router;
