import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as dashboardController from './controller.js';

/**
 * /dashboard/<role> (spec §7.18, §14, Phase 10): one endpoint per role with every widget of
 * that role's dashboard. Each role reads only its own dashboard.
 */
const router = Router();
const { ADMIN, RECEPTIONIST, DOCTOR, LABTECH, PATIENT } = ROLES;

router.get('/admin', authenticate, authorize(ADMIN), asyncHandler(dashboardController.admin));
router.get(
  '/reception',
  authenticate,
  authorize(RECEPTIONIST),
  asyncHandler(dashboardController.reception),
);
router.get('/doctor', authenticate, authorize(DOCTOR), asyncHandler(dashboardController.doctor));
router.get('/lab', authenticate, authorize(LABTECH), asyncHandler(dashboardController.lab));
router.get('/patient', authenticate, authorize(PATIENT), asyncHandler(dashboardController.patient));

export default router;
