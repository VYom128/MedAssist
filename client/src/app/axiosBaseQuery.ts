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
}

interface RefreshPayload {
  accessToken: string;
  user: CurrentUser;
}

/** Endpoints where a 401 means "wrong credentials/token", not "access token expired". */
const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/reset-password'];

let refreshing: Promise<boolean> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request
 * (mutex), because every refresh rotates the cookie. Dispatches credentialsReceived or loggedOut.
 * Also used on page load to restore the session.
 */
export function refreshSession(dispatch: Dispatch): Promise<boolean> {
  refreshing ??= http
    .post<ApiSuccess<RefreshPayload>>('/auth/refresh', null, { headers: CSRF_HEADERS })
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
  const send = () => {
    const token = tokenOf(getState);
    return http.request({
      url: args.url,
      method: args.method ?? 'GET',
      data: args.data,
      params: args.params,
      headers: { ...args.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };

  try {
    return { data: (await send()).data };
  } catch (err) {
    const error = toApiQueryError(err);
    if (error.status !== 401 || NO_REFRESH.includes(args.url)) return { error };

    if (!(await refreshSession(dispatch))) return { error };
    try {
      return { data: (await send()).data };
    } catch (retryErr) {
      return { error: toApiQueryError(retryErr) };
    }
  }
};
