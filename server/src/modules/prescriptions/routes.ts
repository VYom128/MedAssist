import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as prescriptionsController from './controller.js';
import {
  issuePrescriptionSchema,
  listPrescriptionsSchema,
  prescriptionIdSchema,
  prescriptionReasonSchema,
} from './validation.js';

/**
 * /prescriptions (spec §7.12). Reads are scoped by policies/prescriptionAccess: doctors their
 * own and issued prescriptions of related patients; patients their own issued/completed ones;
 * receptionists issued/completed ones for printing. Changes: the prescribing doctor only.
 * GET /:id/print is the printed sheet. The draft is edited through PUT
 * /encounters/:id/prescription. PDFs come in Phase 10, patient
 * explanations in Phase 9.
 */
const router = Router();
const { DOCTOR, PATIENT, RECEPTIONIST } = ROLES;
const readers = [authenticate, authorize(DOCTOR, PATIENT, RECEPTIONIST)];
const prescriber = [authenticate, authorize(DOCTOR)];

router.get(
  '/',
  ...readers,
  validate(listPrescriptionsSchema),
  asyncHandler(prescriptionsController.listPrescriptions),
);
router.get(
  '/:id',
  ...readers,
  validate(prescriptionIdSchema),
  asyncHandler(prescriptionsController.getPrescription),
);
router.get(
  '/:id/print',
  ...readers,
  validate(prescriptionIdSchema),
  asyncHandler(prescriptionsController.getPrintSheet),
);
router.post(
  '/:id/cancel',
  ...prescriber,
  validate(prescriptionReasonSchema),
  asyncHandler(prescriptionsController.cancelPrescription),
);
router.post(
  '/:id/reissue',
  ...prescriber,
  validate(prescriptionReasonSchema),
  asyncHandler(prescriptionsController.reissuePrescription),
);
router.post(
  '/:id/issue',
  ...prescriber,
  validate(issuePrescriptionSchema),
  asyncHandler(prescriptionsController.issuePrescription),
);

export default router;
