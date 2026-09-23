import { Router } from 'express';
import { ROLE_VALUES } from '../../config/constants.js';
import {
  authenticate,
  authenticateAllowingPasswordChange,
} from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter,
  resetPasswordLimiter,
} from '../../middlewares/rateLimiters.js';
import { requireCsrfHeader } from '../../middlewares/requireCsrfHeader.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as authController from './controller.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdSchema,
  updateMeSchema,
} from './validation.js';

/** /auth (spec §7.2). "Any" routes allow every role explicitly (deny by default). */
const router = Router();
const anyRole = authorize(...ROLE_VALUES);

// Public
router.post(
  '/register',
  registerLimiter,
  validate(registerSchema),
  asyncHandler(authController.register),
);
router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(authController.login));
router.post('/refresh', requireCsrfHeader, asyncHandler(authController.refresh));
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(authController.forgotPassword),
);
router.post(
  '/reset-password',
  resetPasswordLimiter,
  validate(resetPasswordSchema),
  asyncHandler(authController.resetPassword),
);

// Allowed while a password change is pending
router.get('/me', authenticateAllowingPasswordChange, anyRole, asyncHandler(authController.getMe));
router.post(
  '/change-password',
  authenticateAllowingPasswordChange,
  anyRole,
  validate(changePasswordSchema),
  asyncHandler(authController.changePassword),
);
router.post(
  '/logout',
  authenticateAllowingPasswordChange,
  anyRole,
  asyncHandler(authController.logout),
);

// Any logged-in user
router.post('/logout-all', authenticate, anyRole, asyncHandler(authController.logoutAll));
router.patch(
  '/me',
  authenticate,
  anyRole,
  validate(updateMeSchema),
  asyncHandler(authController.updateMe),
);
router.get('/sessions', authenticate, anyRole, asyncHandler(authController.listSessions));
router.delete(
  '/sessions/:id',
  authenticate,
  anyRole,
  validate(sessionIdSchema),
  asyncHandler(authController.revokeSession),
);

export default router;
