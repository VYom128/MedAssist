import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as auditController from './controller.js';
import { listAuditLogsSchema } from './validation.js';

/** /audit-logs – admin only (spec §7.18). /audit-logs/patient/:id arrives with patients (Phase 3). */
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/', validate(listAuditLogsSchema), asyncHandler(auditController.listAuditLogs));
router.get('/verify', asyncHandler(auditController.verifyAuditChain));

export default router;
