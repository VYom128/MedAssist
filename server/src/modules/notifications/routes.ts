import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as notificationsController from './controller.js';
import { listNotificationsSchema, notificationIdSchema } from './validation.js';

/**
 * /notifications (spec §7.17, Phase 10) – any logged-in user, their own notifications only
 * (the service scopes every query to the caller).
 */
const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate(listNotificationsSchema),
  asyncHandler(notificationsController.listNotifications),
);
router.get('/unread-count', asyncHandler(notificationsController.getUnreadCount));
router.post('/read-all', asyncHandler(notificationsController.markAllRead));
router.post(
  '/:id/read',
  validate(notificationIdSchema),
  asyncHandler(notificationsController.markRead),
);

export default router;
