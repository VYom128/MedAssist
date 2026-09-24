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
 * /encounters – clinical notes (spec §7.10). Doctors only in Phase 5: their own notes, and signed
 * notes of patients they have a care relationship with (policies/encounterAccess; others → 404).
 * Admins and receptionists never read notes; patients get a patient-safe view in Phase 8.
 * GET /appointments/:id/encounter (the workspace's entry point) is in appointments/routes.ts.
 */
const router = Router();
router.use(authenticate, authorize(ROLES.DOCTOR));

router.get('/', validate(listEncountersSchema), asyncHandler(encountersController.listEncounters));
router.get('/:id', validate(encounterIdSchema), asyncHandler(encountersController.getEncounter));
router.patch(
  '/:id',
  validate(updateEncounterSchema),
  asyncHandler(encountersController.updateEncounter),
);

router.post(
  '/:id/sign',
  validate(signEncounterSchema),
  asyncHandler(encountersController.signEncounter),
);
router.post(
  '/:id/amendments',
  validate(amendEncounterSchema),
  asyncHandler(encountersController.amendEncounter),
);
router.get(
  '/:id/amendments',
  validate(encounterIdSchema),
  asyncHandler(encountersController.listAmendments),
);
// The draft prescription of the note (spec §7.12).
router.put(
  '/:id/prescription',
  validate(putPrescriptionSchema),
  asyncHandler(encountersController.putPrescription),
);

export default router;
