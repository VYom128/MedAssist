import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uploadLimiter } from '../../middlewares/rateLimiters.js';
import { singleFile } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as documentsController from './controller.js';
import {
  deleteDocumentSchema,
  documentIdSchema,
  listDocumentsSchema,
  uploadDocumentSchema,
} from './validation.js';

/**
 * /documents (spec §7.16). Uploads: doctors, reception, lab techs and patients (categories per
 * role, policies/documentAccess); reads scoped per role; admins see metadata only and soft-delete;
 * files are never served statically – downloads stream through here, audited.
 */
const router = Router();
const { ADMIN, DOCTOR, LABTECH, PATIENT, RECEPTIONIST } = ROLES;
const uploaders = [DOCTOR, RECEPTIONIST, LABTECH, PATIENT] as const;

router.post(
  '/',
  authenticate,
  authorize(...uploaders),
  uploadLimiter,
  singleFile,
  validate(uploadDocumentSchema),
  asyncHandler(documentsController.uploadDocument),
);
router.get(
  '/',
  authenticate,
  authorize(ADMIN, ...uploaders),
  validate(listDocumentsSchema),
  asyncHandler(documentsController.listDocuments),
);
router.get(
  '/:id',
  authenticate,
  authorize(ADMIN, ...uploaders),
  validate(documentIdSchema),
  asyncHandler(documentsController.getDocument),
);
router.get(
  '/:id/download',
  authenticate,
  authorize(...uploaders),
  validate(documentIdSchema),
  asyncHandler(documentsController.downloadDocument),
);
router.post(
  '/:id/delete',
  authenticate,
  authorize(ADMIN, ...uploaders),
  validate(deleteDocumentSchema),
  asyncHandler(documentsController.deleteDocument),
);

export default router;
