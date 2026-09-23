import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface SuccessOptions<T> {
  statusCode?: number;
  message?: string;
  data?: T;
  meta?: PaginationMeta | Record<string, unknown>;
}

/** Sends `{ success: true, message, data, meta? }` (spec §7.1). */
export function sendSuccess<T>(
  res: Response,
  { statusCode = 200, message = 'OK', data, meta }: SuccessOptions<T> = {},
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data: data ?? null,
    ...(meta ? { meta } : {}),
  });
}
