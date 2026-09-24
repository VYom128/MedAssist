import { Router } from 'express';
import appointmentRoutes from '../modules/appointments/routes.js';
import auditRoutes from '../modules/audit/routes.js';
import authRoutes from '../modules/auth/routes.js';
import departmentRoutes from '../modules/departments/routes.js';
import doctorRoutes from '../modules/doctors/routes.js';
import encounterRoutes from '../modules/encounters/routes.js';
import formularyRoutes from '../modules/formulary/routes.js';
import healthRoutes from '../modules/health/routes.js';
import labTestRoutes from '../modules/labTests/routes.js';
import queueRoutes from '../modules/queue/routes.js';
import patientRoutes from '../modules/patients/routes.js';
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
router.use('/doctors', doctorRoutes);
router.use('/lab-tests', labTestRoutes);
router.use('/patients', patientRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/queue', queueRoutes);
router.use('/encounters', encounterRoutes);
router.use('/formulary', formularyRoutes);

export default router;
