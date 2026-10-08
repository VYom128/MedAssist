import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as encountersController from '../encounters/controller.js';
import * as timelineController from '../timeline/controller.js';
import { myTimelineSchema, patientTimelineSchema } from '../timeline/validation.js';
import * as patientsController from './controller.js';
import {
  checkDuplicateSchema,
  clinicalProfileSchema,
  confirmLinkSchema,
  createPatientSchema,
  listPatientsSchema,
  patientIdSchema,
  patientStatusSchema,
  myVisitsSchema,
  pendingLinksSchema,
  rejectLinkSchema,
  updateMyRecordSchema,
  updatePatientSchema,
} from './validation.js';

/**
 * /patients (spec §7.7). Which patients a caller may see is decided by policies/patientAccess:
 * doctors list, read and update the clinical profile of patients they have a care relationship
 * with (others → 404); patients may open only their own record (others → 404). Lab
 * technicians have no patient endpoints until Phase 6.
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
// Patient portal (before /:id). A pending self-signup gets 403 PATIENT_LINK_PENDING.
router.get('/me', authenticate, authorize(PATIENT), asyncHandler(patientsController.getMyRecord));
router.patch(
  '/me',
  authenticate,
  authorize(PATIENT),
  validate(updateMyRecordSchema),
  asyncHandler(patientsController.updateMyRecord),
);
// The patient's own history (Phase 8): timeline, signed visits, planned follow-ups to book.
router.get(
  '/me/timeline',
  authenticate,
  authorize(PATIENT),
  validate(myTimelineSchema),
  asyncHandler(timelineController.getMyTimeline),
);
router.get(
  '/me/visits',
  authenticate,
  authorize(PATIENT),
  validate(myVisitsSchema),
  asyncHandler(encountersController.listMyVisits),
);
router.get(
  '/me/follow-ups-due',
  authenticate,
  authorize(PATIENT),
  asyncHandler(encountersController.listMyFollowUpsDue),
);
router.get(
  '/pending-links',
  ...frontDesk,
  validate(pendingLinksSchema),
  asyncHandler(patientsController.listPendingLinks),
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
// Patient timeline (spec §8.8): doctors with a care relationship, reception (non-clinical items).
router.get(
  '/:id/timeline',
  authenticate,
  authorize(DOCTOR, RECEPTIONIST),
  validate(patientTimelineSchema),
  asyncHandler(timelineController.getPatientTimeline),
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

router.post(
  '/:id/portal-invite',
  ...frontDesk,
  validate(patientIdSchema),
  asyncHandler(patientsController.inviteToPortal),
);
router.post(
  '/:id/confirm-link',
  authenticate,
  authorize(RECEPTIONIST),
  validate(confirmLinkSchema),
  asyncHandler(patientsController.confirmLink),
);
router.post(
  '/:id/reject-link',
  authenticate,
  authorize(RECEPTIONIST),
  validate(rejectLinkSchema),
  asyncHandler(patientsController.rejectLink),
);

export default router;
