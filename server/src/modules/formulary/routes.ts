import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as formularyController from './controller.js';
import { searchFormularySchema } from './validation.js';

/**
 * /formulary – drug autocomplete for prescriptions (doctors). Static data (data/formulary.ts);
 * doctors may still prescribe drugs that are not listed.
 */
const router = Router();

router.get(
  '/',
  authenticate,
  authorize(ROLES.DOCTOR),
  validate(searchFormularySchema),
  asyncHandler(formularyController.search),
);

export default router;
