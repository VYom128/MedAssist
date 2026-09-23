import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { AdminUser } from '../src/features/users/api';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

const adminUser = (over: Partial<AdminUser>): AdminUser => ({
  id: 'x',
  firstName: 'A',
  lastName: 'B',
  email: 'a@b.dev',
  phone: null,
  role: 'receptionist',
  isActive: true,
  isLocked: false,
  lockUntil: null,
  failedLoginAttempts: 0,
  mustChangePassword: false,
  emailVerifiedAt: null,
  lastLoginAt: null,
  patientId: null,
  patientLinkStatus: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: null,
  ...over,
});

const ROWS = [
  adminUser({ id: 'u1', firstName: 'Ravi', lastName: 'Kumar', email: 'reception1@medassist.dev' }),
  adminUser({
    id: 'u2',
    firstName: 'Lakshmi',
    lastName: 'Nair',
    email: 'lab1@medassist.dev',
    role: 'labtech',
    isLocked: true,
  }),
  adminUser({
    id: 'u3',
    firstName: 'Kavya',
    lastName: 'Iyer',
    email: 'dr.iyer@medassist.dev',
    role: 'doctor',
    isActive: false,
  }),
];

describe('UsersPage', () => {
  const admin = makeUser('admin', { id: 'me' });
  let lastQuery: URLSearchParams;

  beforeEach(() => {
    server.use(
      http.get(url('/users'), ({ request }) => {
        lastQuery = new URL(request.url).searchParams;
        const role = lastQuery.get('role');
        const items = role ? ROWS.filter((u) => u.role === role) : ROWS;
        return ok(items, { meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } });
      }),
    );
  });

  it('renders rows from the API with status badges and the right actions', async () => {
    renderRoutes(routes, '/admin/users', authState(admin));
    const table = await screen.findByRole('table', { name: 'Users' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Ravi Kumar');
    expect(rows[0]).toHaveTextContent('Active');
    expect(rows[1]).toHaveTextContent('Locked');
    expect(rows[2]).toHaveTextContent('Inactive');

    // Unlock only for the locked user; Activate only for the inactive one.
    expect(
      within(rows[1]!).getByRole('button', { name: 'Unlock Lakshmi Nair' }),
    ).toBeInTheDocument();
    expect(within(rows[0]!).queryByRole('button', { name: /Unlock/ })).not.toBeInTheDocument();
    expect(
      within(rows[2]!).getByRole('button', { name: 'Activate Kavya Iyer' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Showing', { exact: false })).toHaveTextContent('Showing 1–3 of 3');
  });

  it('keeps filters in the URL and sends them to the API', async () => {
    const { router } = renderRoutes(routes, '/admin/users', authState(admin));
    await screen.findByRole('table', { name: 'Users' });
    await userEvent.setup().selectOptions(screen.getByLabelText('Role'), 'labtech');

    await waitFor(() => expect(router.state.location.search).toBe('?role=labtech'));
    await waitFor(() => expect(lastQuery.get('role')).toBe('labtech'));
    const table = await screen.findByRole('table', { name: 'Users' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
  });

  it('opens the add-staff modal, validates, and creates the user', async () => {
    let body: unknown;
    server.use(
      http.post(url('/users'), async ({ request }) => {
        body = await request.json();
        return ok(adminUser({ id: 'new', firstName: 'Neha', lastName: 'Gupta', role: 'doctor' }), {
          status: 201,
        });
      }),
    );
    renderRoutes(routes, '/admin/users', authState(admin));
    await screen.findByRole('table', { name: 'Users' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add staff' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add staff' });
    await user.click(within(dialog).getByRole('button', { name: 'Add staff' }));
    // Validation: nothing was sent, the required fields are flagged.
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Role')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(within(dialog).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(body).toBeUndefined();

    await user.type(within(dialog).getByLabelText('First name'), 'Neha');
    await user.type(within(dialog).getByLabelText('Last name'), 'Gupta');
    await user.type(within(dialog).getByLabelText('Email'), 'neha@clinic.dev');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'doctor');
    await user.click(within(dialog).getByRole('button', { name: 'Add staff' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(body).toEqual({
      firstName: 'Neha',
      lastName: 'Gupta',
      email: 'neha@clinic.dev',
      role: 'doctor',
    });
  });

  it('shows an empty state with a way to clear filters', async () => {
    server.use(
      http.get(url('/users'), () =>
        ok([], { meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
      ),
    );
    renderRoutes(routes, '/admin/users?q=nobody', authState(admin));
    expect(await screen.findByText('No users match these filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});
