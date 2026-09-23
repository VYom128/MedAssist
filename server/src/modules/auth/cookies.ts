import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_COOKIE } from '../../config/constants.js';
import { config } from '../../config/env.js';

const baseOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: config.cookie.sameSite,
  path: REFRESH_COOKIE.path,
});

/** Sets the httpOnly refresh cookie `ma_rt`, scoped to /api/v1/auth (spec §7.1). */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE.name, token, {
    ...baseOptions(),
    maxAge: config.auth.refreshTtlDays * 86_400_000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE.name, baseOptions());
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
    REFRESH_COOKIE.name
  ];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
