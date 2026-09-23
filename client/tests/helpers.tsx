import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { makeStore, type RootState } from '../src/app/store';
import type { Role } from '../src/constants/roles';
import type { CurrentUser } from '../src/features/auth/authSlice';

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

/** Auth state for a signed-in user (or a guest when `user` is null). */
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
