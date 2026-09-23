import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as labTestsController from './controller.js';
import {
  createLabTestSchema,
  labTestIdSchema,
  listLabTestsSchema,
  updateLabTestSchema,
} from './validation.js';

/** /lab-tests – catalogue (spec §7.14). Reads: any logged-in user (patients: name and price). */
const router = Router();
router.use(authenticate);
const adminOnly = authorize(ROLES.ADMIN);

router.get('/', validate(listLabTestsSchema), asyncHandler(labTestsController.listLabTests));
router.get('/:id', validate(labTestIdSchema), asyncHandler(labTestsController.getLabTest));
router.post(
  '/',
  adminOnly,
  validate(createLabTestSchema),
  asyncHandler(labTestsController.createLabTest),
);
router.patch(
  '/:id',
  adminOnly,
  validate(updateLabTestSchema),
  asyncHandler(labTestsController.updateLabTest),
);
router.post(
  '/:id/deactivate',
  adminOnly,
  validate(labTestIdSchema),
  asyncHandler(labTestsController.deactivateLabTest),
);
router.post(
  '/:id/activate',
  adminOnly,
  validate(labTestIdSchema),
  asyncHandler(labTestsController.activateLabTest),
);

export default router;
