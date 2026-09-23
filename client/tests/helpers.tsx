import { render } from '@testing-library/react';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { makeStore, type RootState } from '../src/app/store';
import type { CurrentUser } from '../src/features/auth/authSlice';
import type { Role } from '../src/constants/roles';
import { http } from '../src/utils/http';

export function makeUser(role: Role, overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 'u1',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@medassist.dev',
    phone: null,
    role,
    mustChangePassword: false,
    emailVerifiedAt: null,
    lastLoginAt: null,
    avatarUrl: null,
    patientId: null,
    doctorProfileId: null,
    ...overrides,
  };
}

/** Auth state for a logged-in user (or a guest when `user` is null). */
export function authState(user: CurrentUser | null): Partial<RootState> {
  return {
    auth: user
      ? { user, accessToken: 'test-token', status: 'authenticated' }
      : { user: null, accessToken: null, status: 'guest' },
  };
}

/** Renders `routes` at `path` with a fresh store. */
export function renderRoutes(routes: RouteObject[], path: string, preloaded?: Partial<RootState>) {
  const store = makeStore(preloaded);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>,
  );
  return { ...utils, store, router };
}

type Handler = (config: InternalAxiosRequestConfig) => { status: number; body: unknown };

/**
 * Replaces the axios adapter so no real requests are made. The handler returns
 * `{ status, body }`; non-2xx statuses reject like a real server error.
 */
export function mockHttp(handler: Handler) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const { status, body } = handler(config);
    const response: AxiosResponse = {
      data: body,
      status,
      statusText: String(status),
      headers: {},
      config,
    };
    if (status >= 400) {
      throw new AxiosError('Request failed', String(status), config, null, response);
    }
    return response;
  };
  const original = http.defaults.adapter;
  http.defaults.adapter = adapter;
  return { calls, restore: () => (http.defaults.adapter = original) };
}

export const ok = (data: unknown, message = 'OK') => ({
  status: 200,
  body: { success: true, message, data },
});

export const fail = (status: number, code: string, message = 'Error', details?: unknown) => ({
  status,
  body: { success: false, message, error: { code, details }, requestId: 'req-test' },
});
