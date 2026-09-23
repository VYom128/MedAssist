import { screen } from '@testing-library/react';
import { routes } from '../src/routes/routes';
import { authState, makeUser, mockHttp, ok, renderRoutes } from './helpers';

describe('route guards', () => {
  let mock: ReturnType<typeof mockHttp> | undefined;
  beforeEach(() => {
    mock = mockHttp(() => ok(null));
  });
  afterEach(() => mock?.restore());

  it('sends guests to /login with a next parameter', async () => {
    const { router } = renderRoutes(routes, '/admin/dashboard', authState(null));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Fdashboard');
  });

  it('shows the dashboard to the matching role', async () => {
    renderRoutes(routes, '/admin/dashboard', authState(makeUser('admin', { firstName: 'Asha' })));
    expect(await screen.findByRole('heading', { name: 'Welcome, Asha' })).toBeInTheDocument();
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
  });

  it.each([
    ['patient', '/admin/dashboard'],
    ['doctor', '/reception/dashboard'],
    ['labtech', '/doctor/dashboard'],
  ] as const)('sends a %s visiting %s to /403', async (role, path) => {
    const { router } = renderRoutes(routes, path, authState(makeUser(role)));
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/403');
  });

  it('redirects "/" to the role dashboard', async () => {
    const { router } = renderRoutes(routes, '/', authState(makeUser('labtech')));
    await screen.findByText('Lab technician dashboard');
    expect(router.state.location.pathname).toBe('/lab/dashboard');
  });

  it('keeps a user who must change their password on /change-password', async () => {
    const { router } = renderRoutes(
      routes,
      '/admin/dashboard',
      authState(makeUser('admin', { mustChangePassword: true })),
    );
    expect(await screen.findByText('Please set a new password')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/change-password');
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('sends signed-in users away from /login', async () => {
    const { router } = renderRoutes(routes, '/login', authState(makeUser('receptionist')));
    await screen.findByText('Receptionist dashboard');
    expect(router.state.location.pathname).toBe('/reception/dashboard');
  });
});
