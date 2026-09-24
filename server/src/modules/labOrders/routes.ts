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
  itemIdSchema,
  labOrderIdSchema,
  labOrderReasonSchema,
  listLabOrdersSchema,
  putResultsSchema,
  reviseItemSchema,
  updateLabOrderSchema,
} from './validation.js';

/**
 * /lab-orders (spec §7.14). Reads are scoped by policies/labOrderAccess: lab technicians every
 * placed order (the worklist); doctors their own and placed orders of related patients;
 * receptionists a status-only view (billing); patients their own released orders. Admins get no
 * lab order endpoints (counts come with the Phase 10 reports). Ordering: the doctor of the note;
 * the lab workflow: lab technicians.
 */
const router = Router();
const { DOCTOR, LABTECH, PATIENT, RECEPTIONIST } = ROLES;
const readers = [authenticate, authorize(DOCTOR, LABTECH, RECEPTIONIST, PATIENT)];
const doctor = [authenticate, authorize(DOCTOR)];
const lab = [authenticate, authorize(LABTECH)];

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

// Lab workflow (spec §4.8): lab technicians.
router.post(
  '/:id/collect-sample',
  ...lab,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.collectSample),
);
router.post(
  '/:id/reject-sample',
  ...lab,
  validate(labOrderReasonSchema),
  asyncHandler(labOrdersController.rejectSample),
);
router.post(
  '/:id/recollect',
  ...lab,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.recollectSample),
);
router.post(
  '/:id/start-processing',
  ...lab,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.startProcessing),
);
router.put(
  '/:id/items/:itemId/results',
  ...lab,
  validate(putResultsSchema),
  asyncHandler(labOrdersController.putItemResults),
);
router.post(
  '/:id/verify',
  ...lab,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.verifyOrder),
);
router.post(
  '/:id/send-back',
  ...lab,
  validate(labOrderReasonSchema),
  asyncHandler(labOrdersController.sendBack),
);
router.post(
  '/:id/release',
  ...lab,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.releaseOrder),
);
router.post(
  '/:id/items/:itemId/revise',
  ...lab,
  validate(reviseItemSchema),
  asyncHandler(labOrdersController.reviseItem),
);
router.post(
  '/:id/items/:itemId/verify-revision',
  ...lab,
  validate(itemIdSchema),
  asyncHandler(labOrdersController.verifyRevision),
);
// The doctor marks results reviewed ("results to review").
router.post(
  '/:id/acknowledge',
  ...doctor,
  validate(labOrderIdSchema),
  asyncHandler(labOrdersController.acknowledgeResults),
);

export default router;
