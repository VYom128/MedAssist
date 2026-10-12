import { z } from 'zod';
import { booleanQuery, idParams, paginationQuery } from '../../utils/zod.js';

/** GET /notifications – `?unread=true`, pagination; newest first (spec §7.17). */
export const listNotificationsSchema = {
  query: z.object({ ...paginationQuery, unread: booleanQuery }),
};

/** POST /notifications/:id/read */
export const notificationIdSchema = { params: idParams };

export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema.query>;
