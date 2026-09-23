import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { AdminDepartment } from '../src/features/departments/api';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

const dept = (over: Partial<AdminDepartment>): AdminDepartment => ({
  id: 'd',
  name: 'Dept',
  code: 'DEP',
  description: null,
  isActive: true,
  activeDoctors: 0,
  createdAt: null,
  updatedAt: null,
  ...over,
});

const ROWS = [
  dept({ id: 'gen', name: 'General Medicine', code: 'GEN', activeDoctors: 2 }),
  dept({ id: 'ent', name: 'ENT', code: 'ENT' }),
];
const meta = (n: number) => ({ page: 1, limit: 20, total: n, totalPages: 1 });
const admin = makeUser('admin', { id: 'me' });

describe('DepartmentsPage', () => {
  let lastQuery: URLSearchParams;
  beforeEach(() => {
    server.use(
      http.get(url('/departments'), ({ request }) => {
        lastQuery = new URL(request.url).searchParams;
        return ok(ROWS, { meta: meta(ROWS.length) });
      }),
    );
  });

  it('lists departments with doctor counts; "show inactive" asks the server for them', async () => {
    renderRoutes(routes, '/admin/departments', authState(admin));
    const table = await screen.findByRole('table', { name: 'Departments' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('General Medicine');
    expect(rows[0]).toHaveTextContent('GEN');
    expect(rows[0]).toHaveTextContent('2');
    expect(lastQuery.get('includeInactive')).toBe('false');

    await userEvent.setup().click(screen.getByRole('switch', { name: 'Show inactive' }));
    await waitFor(() => expect(lastQuery.get('includeInactive')).toBe('true'));
  });

  it('shows the server message when deactivation is blocked', async () => {
    server.use(
      http.post(url('/departments/gen/deactivate'), () =>
        fail(409, 'CONFLICT', 'This department still has 2 active doctors.', { activeDoctors: 2 }),
      ),
    );
    renderRoutes(routes, '/admin/departments', authState(admin));
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Departments' });
    await user.click(within(table).getByRole('button', { name: 'Deactivate General Medicine' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate General Medicine?' });
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(
      await within(dialog).findByText('This department still has 2 active doctors.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // stays open
  });

  it('creates a department (code upper-cased) and maps a duplicate to the field', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(url('/departments'), async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return bodies.length === 1
          ? fail(409, 'CONFLICT', 'A department with this code already exists', {
              fields: ['code'],
            })
          : ok(dept({ id: 'der', name: 'Dermatology', code: 'DER' }), { status: 201 });
      }),
    );
    renderRoutes(routes, '/admin/departments', authState(admin));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add department' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add department' });
    await user.type(within(dialog).getByLabelText('Name'), 'Dermatology');
    await user.type(within(dialog).getByLabelText('Code'), 'der');
    await user.click(within(dialog).getByRole('button', { name: 'Add department' }));

    expect(
      await within(dialog).findByText('Another department already uses this code'),
    ).toBeInTheDocument();
    expect(bodies[0]).toEqual({ name: 'Dermatology', code: 'DER', description: '' });

    await user.click(within(dialog).getByRole('button', { name: 'Add department' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('empty state offers to add the first department', async () => {
    server.use(http.get(url('/departments'), () => ok([], { meta: meta(0) })));
    renderRoutes(routes, '/admin/departments', authState(admin));
    expect(await screen.findByText('No departments yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add department' })).toHaveLength(2);
  });

  it('load errors can be retried', async () => {
    let calls = 0;
    server.use(
      http.get(url('/departments'), () => {
        calls += 1;
        return calls === 1
          ? fail(500, 'INTERNAL_ERROR', 'Something went wrong')
          : ok(ROWS, { meta: meta(2) });
      }),
    );
    renderRoutes(routes, '/admin/departments', authState(admin));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Departments' })).toBeInTheDocument();
  });
});
