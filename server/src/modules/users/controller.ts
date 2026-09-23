import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import * as usersService from './service.js';
import type { ListUsersQuery } from './validation.js';

const admin = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function listUsers(req: Request, res: Response) {
  const query = req.query as unknown as ListUsersQuery;
  const { items, meta } = await usersService.listUsers(query, parsePagination(query));
  return sendSuccess(res, { data: items, meta });
}

export async function getUser(req: Request, res: Response) {
  return sendSuccess(res, { data: await usersService.getUser(idOf(req)) });
}

export async function createUser(req: Request, res: Response) {
  const data = await usersService.createUser(admin(req), req.body, buildRequestMeta(req));
  return sendSuccess(res, {
    statusCode: 201,
    message: 'User created. A link to set their password has been emailed.',
    data,
  });
}

export async function updateUser(req: Request, res: Response) {
  const data = await usersService.updateUser(
    admin(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'User updated', data });
}

export async function deactivateUser(req: Request, res: Response) {
  const data = await usersService.deactivateUser(admin(req), idOf(req), buildRequestMeta(req));
  return sendSuccess(res, { message: 'User deactivated', data });
}

export async function activateUser(req: Request, res: Response) {
  const data = await usersService.activateUser(admin(req), idOf(req), buildRequestMeta(req));
  return sendSuccess(res, { message: 'User activated', data });
}

export async function resetPassword(req: Request, res: Response) {
  await usersService.sendPasswordReset(admin(req), idOf(req), buildRequestMeta(req));
  return sendSuccess(res, { message: 'Password reset email sent' });
}

export async function unlockUser(req: Request, res: Response) {
  const data = await usersService.unlockUser(admin(req), idOf(req), buildRequestMeta(req));
  return sendSuccess(res, { message: 'User unlocked', data });
}
