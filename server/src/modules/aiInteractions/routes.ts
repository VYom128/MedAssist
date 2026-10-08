import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as aiController from './controller.js';
import { interactionSummarySchema, listInteractionsSchema } from './validation.js';

/** /ai – the admin AI monitor (spec §7.18, Phase 9). Admins only; never content or the key. */
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN));

router.get(
  '/interactions',
  validate(listInteractionsSchema),
  asyncHandler(aiController.listInteractions),
);
router.get(
  '/interactions/summary',
  validate(interactionSummarySchema),
  asyncHandler(aiController.interactionSummary),
);
router.get('/config', asyncHandler(aiController.aiConfig));

export default router;
