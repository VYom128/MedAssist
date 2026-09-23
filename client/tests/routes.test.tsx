import { screen } from '@testing-library/react';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';

describe('route guards', () => {
  it('sends guests to /login, remembering where they were going', async () => {
    const { router } = renderRoutes(routes, '/admin/dashboard', authState(null));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Fdashboard');
  });

  it('shows a full-page loader while the session is being restored', async () => {
    renderRoutes(routes, '/admin/dashboard', {
      auth: { user: null, accessToken: null, status: 'restoring' },
    });
    expect(await screen.findByText('Loading MedAssist…')).toBeInTheDocument();
  });

  it('shows the dashboard with a role badge to the matching role', async () => {
    renderRoutes(routes, '/admin/dashboard', authState(makeUser('admin', { firstName: 'Asha' })));
    expect(await screen.findByRole('heading', { name: 'Welcome, Asha' })).toBeInTheDocument();
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
  });

  it('builds the sidebar from routeConfig for the role', async () => {
    renderRoutes(routes, '/admin/dashboard', authState(makeUser('admin')));
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Dashboard');
    expect(nav).toHaveTextContent('Users');
    expect(nav).toHaveTextContent('Audit logs');
  });

  it('gives other roles only their dashboard in the sidebar', async () => {
    renderRoutes(routes, '/doctor/dashboard', authState(makeUser('doctor')));
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Dashboard');
    expect(nav).not.toHaveTextContent('Users');
  });

  it.each([
    ['patient', '/admin/users'],
    ['patient', '/admin/dashboard'],
    ['doctor', '/reception/dashboard'],
    ['labtech', '/admin/audit-logs'],
  ] as const)('sends a %s opening %s to the 403 page', async (role, path) => {
    const { router } = renderRoutes(routes, path, authState(makeUser(role)));
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/403');
  });

  it('redirects "/" to the role home, or to /login for guests', async () => {
    const signedIn = renderRoutes(routes, '/', authState(makeUser('labtech')));
    await screen.findByText('Lab technician dashboard');
    expect(signedIn.router.state.location.pathname).toBe('/lab/dashboard');
    signedIn.unmount();

    const guest = renderRoutes(routes, '/', authState(null));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(guest.router.state.location.pathname).toBe('/login');
  });

  it('keeps a user who must change their password on /change-password, with the app hidden', async () => {
    const { router } = renderRoutes(
      routes,
      '/admin/users',
      authState(makeUser('admin', { mustChangePassword: true })),
    );
    expect(await screen.findByText('Please set a new password')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/change-password');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it.each(['/login', '/register', '/forgot-password', '/reset-password/abc'])(
    'sends signed-in users away from %s',
    async (path) => {
      const { router } = renderRoutes(routes, path, authState(makeUser('receptionist')));
      await screen.findByText('Receptionist dashboard');
      expect(router.state.location.pathname).toBe('/reception/dashboard');
    },
  );

  it('shows the 404 page for unknown paths', async () => {
    renderRoutes(routes, '/no/such/page', authState(null));
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
