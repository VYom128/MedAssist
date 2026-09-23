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

/** Error shape returned by the RTK Query base query (see app/axiosBaseQuery.ts). */
export interface ApiQueryError {
  /** HTTP status, or 0 when the server could not be reached. */
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Per-field server validation error (`details` of VALIDATION_ERROR). */
export interface FieldError {
  field: string;
  message: string;
}

/** CSRF header required on cookie-authenticated endpoints (server CSRF_HEADER). */
export const CSRF_HEADERS = { 'X-Requested-With': 'medassist' } as const;

export const http = axios.create({
  baseURL: env.apiUrl,
  // Refresh token travels in an httpOnly cookie from Phase 1.
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Converts any thrown value (usually an AxiosError) to an ApiQueryError. */
export function toApiQueryError(err: unknown): ApiQueryError {
  if (err instanceof AxiosError) {
    const body = err.response?.data as Partial<ApiErrorBody> | undefined;
    if (!err.response) {
      return { status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server' };
    }
    return {
      status: err.response.status,
      code: body?.error?.code ?? 'INTERNAL_ERROR',
      message: body?.message ?? 'Something went wrong',
      details: body?.error?.details,
    };
  }
  return { status: 0, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

/** True for RTK Query errors produced by axiosBaseQuery. */
export function isApiQueryError(err: unknown): err is ApiQueryError {
  return (
    typeof err === 'object' && err !== null && 'code' in err && 'message' in err && 'status' in err
  );
}

/** User-facing message from an RTK Query error (or anything else). */
export function getQueryErrorMessage(err: unknown): string {
  return isApiQueryError(err) ? err.message : 'Something went wrong';
}

/** Pulls a user-facing message out of any axios error. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const body = err.response?.data as Partial<ApiErrorBody> | undefined;
    if (body?.message) return body.message;
    if (!err.response) return 'Cannot reach the server';
  }
  return 'Something went wrong';
}
