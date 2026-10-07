import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as paymentsController from './controller.js';
import { pdfSchema, refundSchema, summarySchema } from './validation.js';

/**
 * /payments (spec §7.15): the day close summary and refunds for reception and admins; receipts
 * for them and the invoice's patient. Payments are recorded under /invoices/:id/payments.
 */
const router = Router();
const { ADMIN, PATIENT, RECEPTIONIST } = ROLES;

router.get(
  '/summary',
  authenticate,
  authorize(ADMIN, RECEPTIONIST),
  validate(summarySchema),
  asyncHandler(paymentsController.daySummary),
);
router.post(
  '/:id/refund',
  authenticate,
  authorize(ADMIN, RECEPTIONIST),
  validate(refundSchema),
  asyncHandler(paymentsController.refundPayment),
);
router.get(
  '/:id/receipt.pdf',
  authenticate,
  authorize(ADMIN, RECEPTIONIST, PATIENT),
  validate(pdfSchema),
  asyncHandler(paymentsController.receiptPdf),
);

export default router;
