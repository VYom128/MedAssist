import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as healthController from './controller.js';

const router = Router();

// Public: used by the client status page and the hosting platform's health check.
router.get('/', asyncHandler(healthController.getHealth));

export default router;
