import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import * as notificationsService from './service.js';
import type { ListNotificationsQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};

export async function listNotifications(req: Request, res: Response) {
  const query = req.query as unknown as ListNotificationsQuery;
  const { items, meta } = await notificationsService.listNotifications(
    currentUser(req),
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getUnreadCount(req: Request, res: Response) {
  return sendSuccess(res, { data: await notificationsService.getUnreadCount(currentUser(req)) });
}

export async function markRead(req: Request, res: Response) {
  const data = await notificationsService.markRead(
    currentUser(req),
    (req.params as { id: string }).id,
  );
  return sendSuccess(res, { message: 'Marked as read', data });
}

export async function markAllRead(req: Request, res: Response) {
  const data = await notificationsService.markAllRead(currentUser(req));
  return sendSuccess(res, { message: 'All marked as read', data });
}
