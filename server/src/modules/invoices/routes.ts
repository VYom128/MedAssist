import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as invoicesController from './controller.js';
import {
  createInvoiceSchema,
  invoiceIdSchema,
  issueInvoiceSchema,
  listInvoicesSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from './validation.js';

/**
 * /invoices (spec §7.15). Reception and admins read and manage every invoice (admins edit drafts,
 * e.g. to approve a larger discount, and void); patients read their own issued invoices
 * (others and drafts → 404). Doctors and lab technicians have no billing endpoints in v1.
 */
const router = Router();
const { ADMIN, PATIENT, RECEPTIONIST } = ROLES;
const readers = [authenticate, authorize(ADMIN, RECEPTIONIST, PATIENT)];
const desk = [authenticate, authorize(ADMIN, RECEPTIONIST)];

router.get(
  '/',
  ...readers,
  validate(listInvoicesSchema),
  asyncHandler(invoicesController.listInvoices),
);
router.post(
  '/',
  ...desk,
  validate(createInvoiceSchema),
  asyncHandler(invoicesController.createInvoice),
);
router.get(
  '/:id',
  ...readers,
  validate(invoiceIdSchema),
  asyncHandler(invoicesController.getInvoice),
);
router.patch(
  '/:id',
  ...desk,
  validate(updateInvoiceSchema),
  asyncHandler(invoicesController.updateInvoice),
);
router.post(
  '/:id/issue',
  ...desk,
  validate(issueInvoiceSchema),
  asyncHandler(invoicesController.issueInvoice),
);
router.post(
  '/:id/void',
  ...desk,
  validate(voidInvoiceSchema),
  asyncHandler(invoicesController.voidInvoice),
);

export default router;
