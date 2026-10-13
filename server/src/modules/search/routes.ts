import { Router } from 'express';
import { ROLE_VALUES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as searchController from './controller.js';
import { searchSchema } from './validation.js';

/** /search (spec §7.18, §12.1) – every role; results are scoped to what the caller may see. */
const router = Router();

router.get(
  '/',
  authenticate,
  authorize(...ROLE_VALUES),
  validate(searchSchema),
  asyncHandler(searchController.search),
);

export default router;
