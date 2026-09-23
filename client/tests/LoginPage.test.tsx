import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../src/routes/routes';
import { authState, fail, makeUser, mockHttp, ok, renderRoutes } from './helpers';

describe('LoginPage', () => {
  let mock: ReturnType<typeof mockHttp> | undefined;
  afterEach(() => mock?.restore());

  const fill = async (email: string, password: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), email);
    await user.type(screen.getByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('shows field errors without calling the API', async () => {
    mock = mockHttp(() => ok(null));
    renderRoutes(routes, '/login', authState(null));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(mock.calls).toHaveLength(0);
  });

  it('shows the server message for wrong credentials', async () => {
    mock = mockHttp(() => fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password'));
    renderRoutes(routes, '/login', authState(null));
    await screen.findByRole('heading', { name: 'Sign in' });
    await fill('dr.mehta@medassist.dev', 'wrong-pass1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('stores the session in memory and lands on the role dashboard', async () => {
    const doctor = makeUser('doctor', { firstName: 'Anil' });
    mock = mockHttp(() => ok({ accessToken: 'abc', expiresIn: 900, user: doctor }, 'Logged in'));
    const { router, store } = renderRoutes(routes, '/login', authState(null));
    await screen.findByRole('heading', { name: 'Sign in' });
    await fill('dr.mehta@medassist.dev', 'Password@123');

    expect(await screen.findByRole('heading', { name: 'Welcome, Anil' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/doctor/dashboard');
    expect(store.getState().auth).toMatchObject({ accessToken: 'abc', status: 'authenticated' });
    expect(JSON.parse(mock.calls[0]?.data as string)).toEqual({
      email: 'dr.mehta@medassist.dev',
      password: 'Password@123',
    });
    expect(window.localStorage.length).toBe(0);
  });

  it('follows a safe ?next= path and ignores an external one', async () => {
    const admin = makeUser('admin');
    mock = mockHttp(() => ok({ accessToken: 'abc', expiresIn: 900, user: admin }));

    const first = renderRoutes(routes, '/login?next=%2Fprofile', authState(null));
    await screen.findByRole('heading', { name: 'Sign in' });
    await fill('admin@medassist.dev', 'Password@123');
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/profile'));
    first.unmount();

    const second = renderRoutes(routes, '/login?next=%2F%2Fevil.example', authState(null));
    await screen.findByRole('heading', { name: 'Sign in' });
    await fill('admin@medassist.dev', 'Password@123');
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/admin/dashboard'));
  });
});
