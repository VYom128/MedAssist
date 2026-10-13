import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { exportLimiter } from '../../middlewares/rateLimiters.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { report } from './controller.js';
import {
  appointmentsReportSchema,
  labTatReportSchema,
  noShowsReportSchema,
  revenueReportSchema,
  utilisationReportSchema,
} from './validation.js';

/**
 * /reports (spec §7.18, Phase 10): revenue and doctor utilisation are admin only; appointments
 * and no-shows also for reception (operational); lab turnaround also for lab technicians.
 * `format=csv` downloads are rate limited per user and audited.
 */
const router = Router();
const { ADMIN, RECEPTIONIST, LABTECH } = ROLES;

router.get(
  '/appointments',
  authenticate,
  authorize(ADMIN, RECEPTIONIST),
  exportLimiter,
  validate(appointmentsReportSchema),
  asyncHandler(report('appointments')),
);
router.get(
  '/revenue',
  authenticate,
  authorize(ADMIN),
  exportLimiter,
  validate(revenueReportSchema),
  asyncHandler(report('revenue')),
);
router.get(
  '/doctor-utilisation',
  authenticate,
  authorize(ADMIN),
  exportLimiter,
  validate(utilisationReportSchema),
  asyncHandler(report('doctor-utilisation')),
);
router.get(
  '/lab-turnaround',
  authenticate,
  authorize(ADMIN, LABTECH),
  exportLimiter,
  validate(labTatReportSchema),
  asyncHandler(report('lab-turnaround')),
);
router.get(
  '/no-shows',
  authenticate,
  authorize(ADMIN, RECEPTIONIST),
  exportLimiter,
  validate(noShowsReportSchema),
  asyncHandler(report('no-shows')),
);

export default router;
