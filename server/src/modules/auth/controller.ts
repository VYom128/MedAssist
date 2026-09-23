import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookies.js';
import * as authService from './service.js';

/** Sends login/register/refresh results: refresh token in the cookie, the rest in the body. */
function sendAuthResult(
  res: Response,
  { refreshToken, ...data }: authService.AuthResult,
  message: string,
  statusCode = 200,
) {
  if (refreshToken) setRefreshCookie(res, refreshToken);
  return sendSuccess(res, { statusCode, message, data });
}

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};

export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body, buildRequestMeta(req));
  return sendAuthResult(res, result, 'Account created', 201);
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as { email: string; password: string };
  const result = await authService.login(email, password, buildRequestMeta(req));
  return sendAuthResult(res, result, 'Logged in');
}

export async function refresh(req: Request, res: Response) {
  const token = readRefreshCookie(req);
  if (!token) throw ApiError.unauthorized('No active session');
  try {
    const result = await authService.refresh(token, buildRequestMeta(req));
    return sendAuthResult(res, result, 'Session refreshed');
  } catch (err) {
    clearRefreshCookie(res); // a rejected refresh token is never useful again
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(currentUser(req), buildRequestMeta(req));
  clearRefreshCookie(res);
  return sendSuccess(res, { message: 'Logged out' });
}

export async function logoutAll(req: Request, res: Response) {
  const data = await authService.logoutAll(currentUser(req), buildRequestMeta(req));
  clearRefreshCookie(res);
  return sendSuccess(res, { message: 'Logged out on all devices', data });
}

export async function getMe(req: Request, res: Response) {
  return sendSuccess(res, { data: await authService.getMe(currentUser(req)) });
}

export async function updateMe(req: Request, res: Response) {
  const data = await authService.updateMe(currentUser(req), req.body, buildRequestMeta(req));
  return sendSuccess(res, { message: 'Profile updated', data });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  const data = await authService.changePassword(
    currentUser(req),
    currentPassword,
    newPassword,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Password changed', data });
}

export async function forgotPassword(req: Request, res: Response) {
  await authService.forgotPassword((req.body as { email: string }).email, buildRequestMeta(req));
  return sendSuccess(res, {
    message: 'If an account exists for that email, a reset link has been sent',
  });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body as { token: string; password: string };
  await authService.resetPassword(token, password, buildRequestMeta(req));
  clearRefreshCookie(res);
  return sendSuccess(res, { message: 'Password has been reset. Please log in.' });
}

export async function listSessions(req: Request, res: Response) {
  return sendSuccess(res, { data: await authService.listSessions(currentUser(req)) });
}

export async function revokeSession(req: Request, res: Response) {
  const { current } = await authService.revokeOwnSession(
    currentUser(req),
    (req.params as { id: string }).id,
    buildRequestMeta(req),
  );
  if (current) clearRefreshCookie(res);
  return sendSuccess(res, { message: 'Session revoked' });
}
