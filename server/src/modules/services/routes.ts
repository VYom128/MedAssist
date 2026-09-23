import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate, optionalAuthenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicesController from './controller.js';
import {
  createServiceSchema,
  serviceIdSchema,
  listServicesSchema,
  updateServiceSchema,
} from './validation.js';

/** /services (spec §7.5). Reads are public; admins may also see inactive services. */
const router = Router();
const adminOnly = [authenticate, authorize(ROLES.ADMIN)];

router.get(
  '/',
  optionalAuthenticate,
  validate(listServicesSchema),
  asyncHandler(servicesController.listServices),
);
router.get(
  '/:id',
  optionalAuthenticate,
  validate(serviceIdSchema),
  asyncHandler(servicesController.getService),
);
router.post(
  '/',
  ...adminOnly,
  validate(createServiceSchema),
  asyncHandler(servicesController.createService),
);
router.patch(
  '/:id',
  ...adminOnly,
  validate(updateServiceSchema),
  asyncHandler(servicesController.updateService),
);
router.post(
  '/:id/deactivate',
  ...adminOnly,
  validate(serviceIdSchema),
  asyncHandler(servicesController.deactivateService),
);
router.post(
  '/:id/activate',
  ...adminOnly,
  validate(serviceIdSchema),
  asyncHandler(servicesController.activateService),
);

export default router;
