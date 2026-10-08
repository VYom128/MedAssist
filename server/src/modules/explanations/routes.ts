import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as explanationsController from './controller.js';
import { explainSchema, explanationFeedbackSchema } from './validation.js';

/**
 * AI patient explanations (spec §7.12, §7.13, §9.3): patients for their own issued prescriptions
 * and signed follow-up plans; doctors who may read the record get a preview. Others 404 through
 * the record's own policy. 10 new explanations per hour per user (cached ones are free).
 */
const explainers = [authenticate, authorize(ROLES.PATIENT, ROLES.DOCTOR)];

/** Mounted at /prescriptions. */
export const prescriptionExplainRoutes = Router();
prescriptionExplainRoutes.post(
  '/:id/explain',
  ...explainers,
  validate(explainSchema),
  asyncHandler(explanationsController.explainPrescription),
);
prescriptionExplainRoutes.post(
  '/:id/explain/feedback',
  authenticate,
  authorize(ROLES.PATIENT),
  validate(explanationFeedbackSchema),
  asyncHandler(explanationsController.prescriptionFeedback),
);

/** Mounted at /encounters. */
export const followUpExplainRoutes = Router();
followUpExplainRoutes.post(
  '/:id/follow-up/explain',
  ...explainers,
  validate(explainSchema),
  asyncHandler(explanationsController.explainFollowUp),
);
