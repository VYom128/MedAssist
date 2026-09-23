import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as patientsController from './controller.js';
import {
  checkDuplicateSchema,
  clinicalProfileSchema,
  createPatientSchema,
  listPatientsSchema,
  patientIdSchema,
  patientStatusSchema,
  updatePatientSchema,
} from './validation.js';

/**
 * /patients (spec §7.7). Which patients a caller may see is decided by policies/patientAccess:
 * doctors pass the role check for list/read/clinical profile but see nothing until care
 * relationships exist (Phase 5); patients may open only their own record (others → 404).
 * Lab technicians have no patient endpoints until Phase 6.
 */
const router = Router();
const { ADMIN, RECEPTIONIST, DOCTOR, PATIENT } = ROLES;
const frontDesk = [authenticate, authorize(ADMIN, RECEPTIONIST)];

router.get(
  '/',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR),
  validate(listPatientsSchema),
  asyncHandler(patientsController.listPatients),
);
router.get(
  '/check-duplicate',
  ...frontDesk,
  validate(checkDuplicateSchema),
  asyncHandler(patientsController.checkDuplicate),
);
router.post(
  '/',
  ...frontDesk,
  validate(createPatientSchema),
  asyncHandler(patientsController.createPatient),
);
router.get(
  '/:id',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, DOCTOR, PATIENT),
  validate(patientIdSchema),
  asyncHandler(patientsController.getPatient),
);
router.patch(
  '/:id',
  ...frontDesk,
  validate(updatePatientSchema),
  asyncHandler(patientsController.updatePatient),
);
router.patch(
  '/:id/clinical-profile',
  authenticate,
  authorize(DOCTOR),
  validate(clinicalProfileSchema),
  asyncHandler(patientsController.updateClinicalProfile),
);
router.post(
  '/:id/deactivate',
  authenticate,
  authorize(ADMIN),
  validate(patientStatusSchema),
  asyncHandler(patientsController.deactivatePatient),
);
router.post(
  '/:id/activate',
  authenticate,
  authorize(ADMIN),
  validate(patientStatusSchema),
  asyncHandler(patientsController.activatePatient),
);

export default router;
