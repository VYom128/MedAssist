import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SuccessOptions<T> {
  statusCode?: number;
  message?: string;
  data?: T | null;
  meta?: PaginationMeta | Record<string, unknown>;
}

/**
 * Sends the standard success envelope (spec §7.1): `{ success: true, message, data, meta? }`.
 * `meta` is left out when undefined.
 */
export function sendSuccess<T>(
  res: Response,
  { statusCode = 200, message = 'OK', data = null, meta }: SuccessOptions<T> = {},
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta !== undefined ? { meta } : {}),
  });
}
