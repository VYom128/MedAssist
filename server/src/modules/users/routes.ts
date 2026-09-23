import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as usersController from './controller.js';
import { createUserSchema, listUsersSchema, updateUserSchema, userIdSchema } from './validation.js';

/** /users – admin account management (spec §7.3). */
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/', validate(listUsersSchema), asyncHandler(usersController.listUsers));
router.post('/', validate(createUserSchema), asyncHandler(usersController.createUser));
router.get('/:id', validate(userIdSchema), asyncHandler(usersController.getUser));
router.patch('/:id', validate(updateUserSchema), asyncHandler(usersController.updateUser));
router.post(
  '/:id/deactivate',
  validate(userIdSchema),
  asyncHandler(usersController.deactivateUser),
);
router.post('/:id/activate', validate(userIdSchema), asyncHandler(usersController.activateUser));
router.post(
  '/:id/reset-password',
  validate(userIdSchema),
  asyncHandler(usersController.resetPassword),
);
router.post('/:id/unlock', validate(userIdSchema), asyncHandler(usersController.unlockUser));

export default router;
