import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { Dispatch } from '@reduxjs/toolkit';
import type { AxiosRequestConfig } from 'axios';
import {
  credentialsReceived,
  loggedOut,
  type AuthState,
  type CurrentUser,
} from '../features/auth/authSlice';
import {
  CSRF_HEADERS,
  http,
  toApiQueryError,
  type ApiQueryError,
  type ApiSuccess,
} from '../utils/http';

export interface AxiosQueryArgs {
  url: string;
  method?: AxiosRequestConfig['method'];
  data?: unknown;
  params?: AxiosRequestConfig['params'];
  headers?: Record<string, string>;
  /**
   * 'blob' for file downloads: the result is `{ blob, fileName }` instead of the JSON envelope.
   * Only use it from hooks (useDownload) – a Blob must never be stored in the Redux state.
   */
  responseType?: 'blob';
  /** Upload progress 0…1 (multipart uploads from hooks, never from cached endpoints). */
  onUploadProgress?: (fraction: number) => void;
}

/** A downloaded file (responseType 'blob'). */
export interface DownloadedFile {
  blob: Blob;
  fileName: string | null;
}

/** `attachment; filename="report.pdf"` → 'report.pdf'. */
export function fileNameFrom(disposition: unknown): string | null {
  if (typeof disposition !== 'string') return null;
  return /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
}

/** An error body of a blob request arrives as a Blob: read it back as JSON for the message. */
async function readBlobError(err: unknown) {
  const response = (err as { response?: { data?: unknown } }).response;
  if (response && typeof Blob !== 'undefined' && response.data instanceof Blob) {
    try {
      response.data = JSON.parse(await response.data.text()) as unknown;
    } catch {
      // Not JSON: keep the generic message.
    }
  }
  return err;
}

interface RefreshPayload {
  accessToken: string;
  user: CurrentUser;
}

/**
 * Endpoints where a 401 means "wrong credentials/token", not "access token expired". The queue
 * board's 401 is a wrong kiosk key: refreshing (and then logging out, which resets the cache and
 * refetches) would loop forever.
 */
const NO_REFRESH = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/reset-password',
  '/queue/board',
];

let refreshing: Promise<boolean> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request
 * (mutex), because every refresh rotates the cookie. Dispatches credentialsReceived or loggedOut.
 * Also used on page load to restore the session.
 */
export function refreshSession(dispatch: Dispatch): Promise<boolean> {
  // No body: axios would send the JSON text "null" for a null body, which the server's strict
  // JSON parser rejects with 400.
  refreshing ??= http
    .post<ApiSuccess<RefreshPayload>>('/auth/refresh', undefined, { headers: CSRF_HEADERS })
    .then((res) => {
      dispatch(credentialsReceived(res.data.data));
      return true;
    })
    .catch(() => {
      dispatch(loggedOut());
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const tokenOf = (getState: () => unknown) => (getState() as { auth: AuthState }).auth.accessToken;

/**
 * RTK Query base query over the shared axios instance (utils/http.ts). Adds the Bearer token,
 * returns the whole success envelope `{ success, message, data, meta }` (endpoints pick `data`),
 * and on a 401 refreshes once and retries; if the refresh fails the user is logged out.
 */
export const axiosBaseQuery: BaseQueryFn<AxiosQueryArgs, unknown, ApiQueryError> = async (
  args,
  { getState, dispatch },
) => {
  const send = async () => {
    const token = tokenOf(getState);
    const { onUploadProgress } = args;
    const res = await http.request({
      url: args.url,
      method: args.method ?? 'GET',
      data: args.data,
      params: args.params,
      headers: { ...args.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(args.responseType ? { responseType: args.responseType } : {}),
      ...(onUploadProgress
        ? {
            onUploadProgress: (e: { loaded: number; total?: number }) =>
              onUploadProgress(e.total ? e.loaded / e.total : 0),
          }
        : {}),
    });
    if (args.responseType === 'blob') {
      const file: DownloadedFile = {
        blob: res.data as Blob,
        fileName: fileNameFrom(res.headers['content-disposition']),
      };
      return file;
    }
    return res.data as unknown;
  };
  const failed = async (err: unknown) =>
    toApiQueryError(args.responseType === 'blob' ? await readBlobError(err) : err);

  try {
    return { data: await send() };
  } catch (err) {
    const error = await failed(err);
    if (error.status !== 401 || NO_REFRESH.includes(args.url)) return { error };

    if (!(await refreshSession(dispatch))) return { error };
    try {
      return { data: await send() };
    } catch (retryErr) {
      return { error: await failed(retryErr) };
    }
  }
};
