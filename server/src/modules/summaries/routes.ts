import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as summariesController from './controller.js';
import {
  approveSummarySchema,
  encounterSummarySchema,
  rejectSummarySchema,
  updateSummarySchema,
} from './validation.js';

/**
 * /encounters/:id/summary – AI clinical summaries (spec §7.11). Doctors only: the note's own
 * doctor generates, edits, approves and rejects; a doctor who may read the signed note reads the
 * approved summary (others 404, policies/encounterAccess). Generation is limited to 10 per
 * minute per doctor (counted in ai_interactions, ai/guards.ts).
 */
const router = Router();
const doctor = [authenticate, authorize(ROLES.DOCTOR)];

router.post(
  '/:id/summary/generate',
  ...doctor,
  validate(encounterSummarySchema),
  asyncHandler(summariesController.generateSummary),
);
router.get(
  '/:id/summary',
  ...doctor,
  validate(encounterSummarySchema),
  asyncHandler(summariesController.getSummary),
);
router.patch(
  '/:id/summary/:summaryId',
  ...doctor,
  validate(updateSummarySchema),
  asyncHandler(summariesController.updateSummary),
);
router.post(
  '/:id/summary/:summaryId/approve',
  ...doctor,
  validate(approveSummarySchema),
  asyncHandler(summariesController.approveSummary),
);
router.post(
  '/:id/summary/:summaryId/reject',
  ...doctor,
  validate(rejectSummarySchema),
  asyncHandler(summariesController.rejectSummary),
);

export default router;
