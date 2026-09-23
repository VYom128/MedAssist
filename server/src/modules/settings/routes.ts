import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as settingsController from './controller.js';
import { updateSettingsSchema } from './validation.js';

/** /settings – clinic settings (spec §7.4). */
const router = Router();

router.get('/public', asyncHandler(settingsController.getPublicSettings));
router.get('/', authenticate, authorize(ROLES.ADMIN), asyncHandler(settingsController.getSettings));
router.patch(
  '/',
  authenticate,
  authorize(ROLES.ADMIN),
  validate(updateSettingsSchema),
  asyncHandler(settingsController.updateSettings),
);

export default router;
