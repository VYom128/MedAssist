import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as labOrdersController from './controller.js';
import {
  cancelItemSchema,
  cancelLabOrderSchema,
  createLabOrderSchema,
  labOrderIdSchema,
  listLabOrdersSchema,
  updateLabOrderSchema,
} from './validation.js';

/**
 * /lab-orders (spec §7.14). Reads are scoped by policies/labOrderAccess: lab technicians every
 * placed order (the worklist); doctors their own and placed orders of related patients;
 * receptionists a status-only view (billing); patients their own released orders. Admins get no
 * lab order endpoints (counts come with the Phase 10 reports). Ordering: the doctor of the note.
 */
const router = Router();
const { DOCTOR, LABTECH, PATIENT, RECEPTIONIST } = ROLES;
const readers = [authenticate, authorize(DOCTOR, LABTECH, RECEPTIONIST, PATIENT)];
const doctor = [authenticate, authorize(DOCTOR)];

router.get(
  '/',
  ...readers,
  validate(listLabOrdersSchema),
  asyncHandler(labOrdersController.listLabOrders),
);
router.get(
  '/:id',
  ...readers,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.getLabOrder),
);
router.post(
  '/',
  ...doctor,
  validate(createLabOrderSchema),
  asyncHandler(labOrdersController.createLabOrder),
);
router.patch(
  '/:id',
  ...doctor,
  validate(updateLabOrderSchema),
  asyncHandler(labOrdersController.updateLabOrder),
);
router.post(
  '/:id/discard',
  ...doctor,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.discardLabOrder),
);
router.post(
  '/:id/cancel',
  ...doctor,
  validate(cancelLabOrderSchema),
  asyncHandler(labOrdersController.cancelLabOrder),
);
router.post(
  '/:id/items/:itemId/cancel',
  authenticate,
  authorize(DOCTOR, LABTECH),
  validate(cancelItemSchema),
  asyncHandler(labOrdersController.cancelLabOrderItem),
);

export default router;
