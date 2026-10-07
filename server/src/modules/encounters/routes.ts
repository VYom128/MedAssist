import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as encountersController from './controller.js';
import { putPrescriptionSchema } from '../prescriptions/validation.js';
import {
  amendEncounterSchema,
  encounterIdSchema,
  listEncountersSchema,
  signEncounterSchema,
  updateEncounterSchema,
} from './validation.js';

/**
 * /encounters – clinical notes (spec §7.10). Doctors: their own notes, and signed notes of
 * patients they have a care relationship with (policies/encounterAccess; others → 404). Patients
 * read their own signed notes as a patient-safe view (GET /:id only; Phase 8). Admins and
 * receptionists never read notes.
 * GET /appointments/:id/encounter (the workspace's entry point) is in appointments/routes.ts.
 */
const router = Router();
const doctor = [authenticate, authorize(ROLES.DOCTOR)];

router.get(
  '/',
  ...doctor,
  validate(listEncountersSchema),
  asyncHandler(encountersController.listEncounters),
);
// Patients read their own signed notes as the patient-safe view (Phase 8).
router.get(
  '/:id',
  authenticate,
  authorize(ROLES.DOCTOR, ROLES.PATIENT),
  validate(encounterIdSchema),
  asyncHandler(encountersController.getEncounter),
);
router.patch(
  '/:id',
  ...doctor,
  validate(updateEncounterSchema),
  asyncHandler(encountersController.updateEncounter),
);

router.post(
  '/:id/sign',
  ...doctor,
  validate(signEncounterSchema),
  asyncHandler(encountersController.signEncounter),
);
router.post(
  '/:id/amendments',
  ...doctor,
  validate(amendEncounterSchema),
  asyncHandler(encountersController.amendEncounter),
);
router.get(
  '/:id/amendments',
  ...doctor,
  validate(encounterIdSchema),
  asyncHandler(encountersController.listAmendments),
);
// The draft prescription of the note (spec §7.12).
router.put(
  '/:id/prescription',
  ...doctor,
  validate(putPrescriptionSchema),
  asyncHandler(encountersController.putPrescription),
);

export default router;
