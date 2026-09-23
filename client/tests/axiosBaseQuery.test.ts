import { http } from 'msw';
import { makeStore } from '../src/app/store';
import { authApi } from '../src/features/auth/api';
import { usersApi } from '../src/features/users/api';
import { authState, makeUser } from './helpers';
import { fail, ok, server, url } from './msw/server';

const admin = makeUser('admin');

describe('axiosBaseQuery', () => {
  it('sends the Bearer token and unwraps data', async () => {
    let auth: string | null = null;
    server.use(
      http.get(url('/auth/me'), ({ request }) => {
        auth = request.headers.get('authorization');
        return ok(admin);
      }),
    );
    const store = makeStore(authState(admin));
    const result = await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(result.data).toEqual(admin);
    expect(auth).toBe('Bearer test-token');
  });

  it('3 parallel 401s → exactly one refresh → all 3 retried with the new token', async () => {
    let refreshCalls = 0;
    const authorised = (req: Request) => req.headers.get('authorization') === 'Bearer new-token';
    server.use(
      http.post(url('/auth/refresh'), async ({ request }) => {
        refreshCalls += 1;
        expect(request.headers.get('x-requested-with')).toBe('medassist');
        // A body such as the JSON text "null" is rejected by the server's JSON parser.
        expect(await request.text()).toBe('');
        await new Promise((r) => setTimeout(r, 20)); // keep it in flight while the others fail
        return ok({ accessToken: 'new-token', expiresIn: 900, user: admin });
      }),
      http.get(url('/auth/me'), ({ request }) =>
        authorised(request) ? ok(admin) : fail(401, 'TOKEN_EXPIRED'),
      ),
      http.get(url('/auth/sessions'), ({ request }) =>
        authorised(request) ? ok([]) : fail(401, 'TOKEN_EXPIRED'),
      ),
      http.get(url('/users'), ({ request }) =>
        authorised(request)
          ? ok([], { meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })
          : fail(401, 'TOKEN_EXPIRED'),
      ),
    );
    const store = makeStore(authState(admin));

    const [me, sessions, users] = await Promise.all([
      store.dispatch(authApi.endpoints.getMe.initiate()),
      store.dispatch(authApi.endpoints.getSessions.initiate()),
      store.dispatch(usersApi.endpoints.listUsers.initiate({})),
    ]);

    expect(refreshCalls).toBe(1);
    expect(me.data).toEqual(admin);
    expect(sessions.data).toEqual([]);
    expect(users.data?.items).toEqual([]);
    expect(store.getState().auth.accessToken).toBe('new-token');
  });

  it('logs the user out when the refresh fails', async () => {
    server.use(http.get(url('/auth/me'), () => fail(401, 'TOKEN_EXPIRED')));
    const store = makeStore(authState(admin));
    await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(store.getState().auth).toEqual({ user: null, accessToken: null, status: 'guest' });
  });

  it('does not try to refresh after a failed login', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(url('/auth/refresh'), () => {
        refreshCalls += 1;
        return fail(401, 'SESSION_REVOKED');
      }),
      http.post(url('/auth/login'), () =>
        fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
      ),
    );
    const store = makeStore(authState(null));
    const result = await store.dispatch(
      authApi.endpoints.login.initiate({ email: 'a@b.dev', password: 'x' }),
    );
    expect(result.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(refreshCalls).toBe(0);
  });

  it('reports network failures as status 0', async () => {
    server.use(http.get(url('/auth/me'), () => Response.error()));
    const store = makeStore(authState(admin));
    const result = await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(result.error).toMatchObject({ status: 0, message: 'Cannot reach the server' });
  });
});
