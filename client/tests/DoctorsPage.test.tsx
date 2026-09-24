import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { adminDoctor, DEPARTMENTS, meta } from './doctors.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

const admin = makeUser('admin', { id: 'me' });

describe('Doctors (admin)', () => {
  let lastQuery: URLSearchParams;
  beforeEach(() => {
    server.use(
      http.get(url('/departments'), () => ok(DEPARTMENTS, { meta: meta(2) })),
      http.get(url('/doctors'), ({ request }) => {
        lastQuery = new URL(request.url).searchParams;
        return ok(
          [
            adminDoctor(),
            adminDoctor({
              id: 'dr2',
              name: 'Kavya Iyer',
              isAcceptingAppointments: false,
              isActive: false,
            }),
          ],
          { meta: meta(2) },
        );
      }),
    );
  });

  it('lists doctors (inactive included) and filters by department and bookings', async () => {
    renderRoutes(routes, '/admin/doctors', authState(admin));
    const table = await screen.findByRole('table', { name: 'Doctors' });
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('Dr Anil Mehta');
    expect(first).toHaveTextContent('₹500.00');
    expect(second).toHaveTextContent('Paused');
    expect(second).toHaveTextContent('Inactive');
    expect(lastQuery.get('includeInactive')).toBe('true');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Bookings'), 'no');
    await waitFor(() => expect(lastQuery.get('accepting')).toBe('false'));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Paediatrics' })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText('Department'), 'ped');
    await waitFor(() => expect(lastQuery.get('department')).toBe('ped'));
  });

  it('add doctor: two steps, correct body, then the doctor page with a welcome-email notice', async () => {
    let body: unknown;
    let calls = 0;
    server.use(
      http.post(url('/doctors'), async ({ request }) => {
        calls += 1;
        body = await request.json();
        if (calls === 1) {
          return fail(409, 'CONFLICT', 'An account with this email already exists', {
            fields: ['email'],
          });
        }
        return ok(adminDoctor({ id: 'new', name: 'Neha Gupta', email: 'neha@clinic.dev' }), {
          status: 201,
        });
      }),
      http.get(url('/doctors/new'), () => ok(adminDoctor({ id: 'new', name: 'Neha Gupta' }))),
    );
    const toastModule = await import('react-hot-toast');
    const toastSuccess = vi.spyOn(toastModule.default, 'success');
    const { router } = renderRoutes(routes, '/admin/doctors', authState(admin));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add doctor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add doctor' });

    // Step 1 validates before moving on.
    await user.click(within(dialog).getByRole('button', { name: 'Next: profile' }));
    expect(await within(dialog).findAllByText('Required')).toHaveLength(2);
    await user.type(within(dialog).getByLabelText('First name'), 'Neha');
    await user.type(within(dialog).getByLabelText('Last name'), 'Gupta');
    await user.type(within(dialog).getByLabelText('Email'), 'neha@clinic.dev');
    await user.click(within(dialog).getByRole('button', { name: 'Next: profile' }));

    // Step 2: profile
    expect(await within(dialog).findByText('Step 2 of 2: Profile')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'Paediatrics' })).toBeInTheDocument(),
    );
    await user.selectOptions(within(dialog).getByLabelText('Department'), 'ped');
    await user.type(within(dialog).getByLabelText('Specialization'), 'Paediatrician');
    await user.type(within(dialog).getByLabelText('Registration number'), 'KMC-777');
    await user.type(within(dialog).getByLabelText('Experience (years)'), '8');
    await user.type(within(dialog).getByLabelText('Consultation fee'), '650');
    await user.type(within(dialog).getByLabelText('Qualifications'), 'MBBS{Enter}DCH{Enter}');
    await user.type(within(dialog).getByLabelText('Languages'), 'English{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Add doctor' }));

    // Duplicate email: back to step 1 with the error on the field.
    expect(
      await within(dialog).findByText('An account with this email already exists'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Step 1 of 2: Account')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Email'));
    await user.type(within(dialog).getByLabelText('Email'), 'neha.gupta@clinic.dev');
    await user.click(within(dialog).getByRole('button', { name: 'Next: profile' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add doctor' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/doctors/new'));
    expect(body).toEqual({
      firstName: 'Neha',
      lastName: 'Gupta',
      email: 'neha.gupta@clinic.dev',
      department: 'ped',
      specialization: 'Paediatrician',
      qualifications: ['MBBS', 'DCH'],
      registrationNumber: 'KMC-777',
      experienceYears: 8,
      consultationFeePaise: 65_000,
      slotMinutes: null,
      roomNumber: '',
      bio: '',
      languages: ['English'],
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('welcome email with a link to set their password was sent'),
      expect.anything(),
    );
  });
});

describe('Doctor detail (admin)', () => {
  it('profile tab: accepting switch, account deactivation and profile edits', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    server.use(
      http.get(url('/departments'), () => ok(DEPARTMENTS, { meta: meta(2) })),
      http.get(url('/doctors/dr1'), () => ok(adminDoctor())),
      http.patch(url('/doctors/dr1'), async ({ request }) => {
        const body = await request.json();
        calls.push({ method: 'PATCH', path: '/doctors/dr1', body });
        return ok(adminDoctor(body as object));
      }),
      http.post(url('/users/dr1/deactivate'), () => {
        calls.push({ method: 'POST', path: '/users/dr1/deactivate' });
        return ok(null);
      }),
    );
    renderRoutes(routes, '/admin/doctors/dr1', authState(admin));
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Dr Anil Mehta' })).toBeInTheDocument();
    expect(screen.getByLabelText('Registration number')).toHaveValue('KMC-12345');
    expect(screen.getByLabelText('Consultation fee')).toHaveValue('500');

    await user.click(screen.getByRole('switch', { name: 'Accepting appointments' }));
    await waitFor(() =>
      expect(calls[0]).toEqual({
        method: 'PATCH',
        path: '/doctors/dr1',
        body: { isAcceptingAppointments: false },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Deactivate Dr Anil Mehta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Dr Anil Mehta?' });
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/users/dr1/deactivate')).toBe(true));
    // The page behind stays inert until the dialog's close transition has finished.
    await waitFor(() => expect(dialog).not.toBeInTheDocument());

    const room = screen.getByLabelText('Room');
    await user.clear(room);
    await user.type(room, '202');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() =>
      expect(calls.at(-1)?.body).toMatchObject({ roomNumber: '202', consultationFeePaise: 50_000 }),
    );
  });

  it('leave tab lists upcoming leave and cancels with confirmation', async () => {
    let cancelled = false;
    server.use(
      http.get(url('/doctors/dr1'), () => ok(adminDoctor())),
      http.get(url('/doctors/dr1/leaves'), ({ request }) => {
        const upcoming = !new URL(request.url).searchParams.get('to');
        const leave = {
          id: 'lv1',
          doctorId: 'dr1',
          // 27–29 Sep 2030, whole days in India
          startAt: '2030-09-26T18:30:00.000Z',
          endAt: '2030-09-29T18:30:00.000Z',
          type: 'conference',
          reason: 'Ortho conference',
          isCancelled: cancelled,
          cancelledAt: null,
          createdAt: null,
        };
        const items = upcoming ? [leave] : [];
        return ok(items, { meta: { page: 1, limit: 100, total: items.length, totalPages: 1 } });
      }),
      http.post(url('/doctors/dr1/leaves/lv1/cancel'), () => {
        cancelled = true;
        return ok({});
      }),
    );
    renderRoutes(routes, '/admin/doctors/dr1?tab=leave', authState(admin));
    expect(await screen.findByText('27 Sep 2030 – 29 Sep 2030')).toBeInTheDocument();
    expect(screen.getByText('Conference')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Cancel leave 27 Sep 2030 – 29 Sep 2030' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this leave?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel leave' }));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });
});
