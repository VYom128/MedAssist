import axios, { AxiosError } from 'axios';
import { env } from './env';

/** Standard API envelopes (spec §7.1). */
export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
  requestId?: string;
}

export const http = axios.create({
  baseURL: env.apiUrl,
  // Refresh token travels in an httpOnly cookie from Phase 1.
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Pulls a user-facing message out of any axios error. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const body = err.response?.data as Partial<ApiErrorBody> | undefined;
    if (body?.message) return body.message;
    if (!err.response) return 'Cannot reach the server';
  }
  return 'Something went wrong';
}
