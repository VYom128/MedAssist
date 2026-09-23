import { Router } from 'express';
import healthRoutes from '../modules/health/routes.js';

/** /api/v1 router. Feature modules are mounted here as they are built. */
const router = Router();

router.use('/health', healthRoutes);

export default router;
