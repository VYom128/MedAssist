import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate, optionalAuthenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as departmentsController from './controller.js';
import {
  createDepartmentSchema,
  departmentIdSchema,
  listDepartmentsSchema,
  updateDepartmentSchema,
} from './validation.js';

/** /departments (spec §7.5). Reads are public; admins may also see inactive departments. */
const router = Router();
const adminOnly = [authenticate, authorize(ROLES.ADMIN)];

router.get(
  '/',
  optionalAuthenticate,
  validate(listDepartmentsSchema),
  asyncHandler(departmentsController.listDepartments),
);
router.get(
  '/:id',
  optionalAuthenticate,
  validate(departmentIdSchema),
  asyncHandler(departmentsController.getDepartment),
);
router.post(
  '/',
  ...adminOnly,
  validate(createDepartmentSchema),
  asyncHandler(departmentsController.createDepartment),
);
router.patch(
  '/:id',
  ...adminOnly,
  validate(updateDepartmentSchema),
  asyncHandler(departmentsController.updateDepartment),
);
router.post(
  '/:id/deactivate',
  ...adminOnly,
  validate(departmentIdSchema),
  asyncHandler(departmentsController.deactivateDepartment),
);
router.post(
  '/:id/activate',
  ...adminOnly,
  validate(departmentIdSchema),
  asyncHandler(departmentsController.activateDepartment),
);

export default router;
