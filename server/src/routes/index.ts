import { Router } from 'express';
import auditRoutes from '../modules/audit/routes.js';
import authRoutes from '../modules/auth/routes.js';
import departmentRoutes from '../modules/departments/routes.js';
import healthRoutes from '../modules/health/routes.js';
import serviceRoutes from '../modules/services/routes.js';
import settingsRoutes from '../modules/settings/routes.js';
import userRoutes from '../modules/users/routes.js';

/** /api/v1 router. Feature modules are mounted here as they are built. */
const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/settings', settingsRoutes);
router.use('/departments', departmentRoutes);
router.use('/services', serviceRoutes);

export default router;
