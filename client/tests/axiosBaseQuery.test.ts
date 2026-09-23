import { AxiosError } from 'axios';
import { makeStore } from '../src/app/store';
import { authApi } from '../src/features/auth/api';
import { authState, fail, makeUser, mockHttp, ok } from './helpers';

const admin = makeUser('admin');

describe('axiosBaseQuery', () => {
  let mock: ReturnType<typeof mockHttp> | undefined;
  afterEach(() => mock?.restore());

  it('sends the Bearer token and unwraps data', async () => {
    mock = mockHttp(() => ok(admin));
    const store = makeStore(authState(admin));
    const result = await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(result.data).toEqual(admin);
    expect(mock.calls[0]?.headers.Authorization).toBe('Bearer test-token');
  });

  it('refreshes once for parallel 401s, then retries each request with the new token', async () => {
    mock = mockHttp((config) => {
      if (config.url === '/auth/refresh') {
        expect(config.headers['X-Requested-With']).toBe('medassist');
        return ok({ accessToken: 'new-token', expiresIn: 900, user: admin });
      }
      if (config.headers.Authorization === 'Bearer new-token') {
        return config.url === '/auth/me' ? ok(admin) : ok([]);
      }
      return fail(401, 'TOKEN_EXPIRED', 'Access token expired');
    });
    const store = makeStore(authState(admin));

    const [me, sessions] = await Promise.all([
      store.dispatch(authApi.endpoints.getMe.initiate()),
      store.dispatch(authApi.endpoints.getSessions.initiate()),
    ]);

    expect(me.data).toEqual(admin);
    expect(sessions.data).toEqual([]);
    expect(mock.calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
    expect(store.getState().auth.accessToken).toBe('new-token');
  });

  it('logs out when the refresh fails', async () => {
    mock = mockHttp((config) =>
      config.url === '/auth/refresh' ? fail(401, 'SESSION_REVOKED') : fail(401, 'TOKEN_EXPIRED'),
    );
    const store = makeStore(authState(admin));
    await store.dispatch(authApi.endpoints.getMe.initiate());

    // Logging out also clears the RTK Query cache, so check the auth state and the calls.
    expect(store.getState().auth).toEqual({ user: null, accessToken: null, status: 'guest' });
    expect(mock.calls.map((c) => c.url)).toEqual(['/auth/me', '/auth/refresh']);
  });

  it('does not try to refresh after a failed login', async () => {
    mock = mockHttp(() => fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password'));
    const store = makeStore(authState(null));
    const result = await store.dispatch(
      authApi.endpoints.login.initiate({ email: 'a@b.dev', password: 'x' }),
    );
    expect(result.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(mock.calls).toHaveLength(1);
  });

  it('reports network failures as status 0', async () => {
    mock = mockHttp((config) => {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config); // no response
    });
    const store = makeStore(authState(admin));
    const result = await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(result.error).toMatchObject({ status: 0, message: 'Cannot reach the server' });
  });
});
