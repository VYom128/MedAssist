import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { Appointment } from '../src/features/appointments/api';
import { routes } from '../src/routes/routes';
import { addDaysToDate, formatCalendarDate } from '../src/utils/dates';
import {
  appointment,
  at,
  calendarEvent,
  DEPARTMENTS,
  DOCTORS,
  PATIENT,
  SERVICES,
  TODAY,
  TOMORROW,
} from './appointments.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

const reception = makeUser('receptionist');
const meta = (total: number) => ({ page: 1, limit: 100, total, totalPages: 1 });

/** Master data every appointment screen loads. */
function catalogHandlers() {
  server.use(
    http.get(url('/doctors'), () => ok(DOCTORS, { meta: meta(DOCTORS.length) })),
    http.get(url('/doctors/:id'), ({ params }) => ok(DOCTORS.find((d) => d.id === params.id))),
    http.get(url('/departments'), () => ok(DEPARTMENTS, { meta: meta(DEPARTMENTS.length) })),
    http.get(url('/services'), () => ok(SERVICES, { meta: meta(SERVICES.length) })),
  );
}

describe('Reception appointments – list view', () => {
  let queries: URLSearchParams[];
  beforeEach(() => {
    queries = [];
    catalogHandlers();
    server.use(
      http.get(url('/appointments'), ({ request }) => {
        const params = new URL(request.url).searchParams;
        queries.push(params);
        const items = params.get('status') === 'no_show' ? [] : [appointment()];
        return ok(items, { meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } });
      }),
    );
  });

  it('lists appointments from today with filters kept in the URL', async () => {
    const { router } = renderRoutes(
      routes,
      '/reception/appointments?view=list',
      authState(reception),
    );
    const user = userEvent.setup();
    // The first render loads the lazy page bundle: allow more time.
    const table = await screen.findByRole('table', { name: 'Appointments' }, { timeout: 5000 });
    expect(within(table).getByRole('link', { name: 'Priya Sharma' })).toHaveAttribute(
      'href',
      '/reception/appointments/a1',
    );
    expect(within(table).getByText('Anil Mehta')).toBeInTheDocument();
    expect(within(table).getByText('Scheduled')).toBeInTheDocument();
    expect(queries[0]!.get('from')).toBe(TODAY);

    await user.click(screen.getByRole('button', { name: 'Checked in' }));
    await user.click(screen.getByRole('button', { name: 'Scheduled' }));
    await waitFor(() => expect(queries.at(-1)!.get('status')).toBe('checked_in,scheduled'));
    expect(router.state.location.search).toContain('status=checked_in%2Cscheduled');

    await user.selectOptions(screen.getByLabelText('Doctor'), 'dr2');
    await waitFor(() => expect(queries.at(-1)!.get('doctor')).toBe('dr2'));
  });

  it('shows an empty state when nothing matches', async () => {
    renderRoutes(routes, '/reception/appointments?view=list&status=no_show', authState(reception));
    expect(await screen.findByText('No appointments match')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    server.use(http.get(url('/appointments'), () => fail(500, 'INTERNAL_ERROR', 'Server down')));
    renderRoutes(routes, '/reception/appointments?view=list', authState(reception));
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Reception appointments – calendar', () => {
  beforeEach(() => {
    catalogHandlers();
    server.use(
      http.get(url('/appointments/calendar'), () => ok([calendarEvent()])),
      http.get(url('/appointments/a1'), () => ok(appointment({ startAt: at(TODAY, '09:30') }))),
    );
  });

  it('day view with a column per doctor; clicking an event opens the drawer', async () => {
    renderRoutes(routes, '/reception/appointments', authState(reception));
    const user = userEvent.setup();
    const event = await screen.findByText('000045 · Priya S.', {}, { timeout: 5000 });
    expect(screen.getAllByText('Anil Mehta').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kavya Iyer').length).toBeGreaterThan(0);
    await user.click(event);
    const drawer = await screen.findByRole('dialog', { name: 'Appointment APT-2026-000045' });
    expect(await within(drawer).findByText('Fever for 3 days')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: /Open full page/ })).toHaveAttribute(
      'href',
      '/reception/appointments/a1',
    );
  });
});

describe('Booking modal', () => {
  it('books through patient → doctor → date → time; a taken slot keeps the other inputs', async () => {
    catalogHandlers();
    const posts: unknown[] = [];
    let slotCalls = 0;
    server.use(
      http.get(url('/appointments/calendar'), () => ok([])),
      http.get(url('/patients'), ({ request }) =>
        ok(new URL(request.url).searchParams.get('q') ? [PATIENT] : [], { meta: meta(1) }),
      ),
      http.get(url('/doctors/dr1/availability'), ({ request }) => {
        const from = new URL(request.url).searchParams.get('from')!;
        const days = Array.from({ length: 7 }, (_, i) => ({
          date: addDaysToDate(from, i),
          freeSlots: 4,
        }));
        return ok({ timezone: 'Asia/Kolkata', slotMinutes: 15, serviceMinutes: 15, days });
      }),
      http.get(url('/doctors/dr1/slots'), () => {
        slotCalls += 1;
        // After the 409 the 09:30 slot is gone.
        const labels = posts.length === 0 ? ['09:30', '09:45'] : ['09:45'];
        return ok({
          date: TOMORROW,
          timezone: 'Asia/Kolkata',
          slotMinutes: 15,
          serviceMinutes: 15,
          slots: labels.map((label) => ({
            startAt: at(TOMORROW, label),
            endAt: at(TOMORROW, label),
            label,
          })),
        });
      }),
      http.post(url('/appointments'), async ({ request }) => {
        posts.push(await request.json());
        if (posts.length === 1) {
          return fail(
            409,
            'SLOT_UNAVAILABLE',
            'This slot was just taken. Please pick another time.',
          );
        }
        return ok(appointment({ startAt: at(TOMORROW, '09:45') }), { status: 201 });
      }),
    );
    renderRoutes(routes, '/reception/appointments', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Book appointment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Book appointment' });

    await user.type(within(dialog).getByRole('combobox', { name: 'Patient' }), 'pri');
    await user.click(await within(dialog).findByRole('option', { name: /Priya Sharma/ }));
    expect(within(dialog).getByRole('button', { name: 'Change' })).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText('Doctor'), 'dr1');
    await waitFor(() => expect(within(dialog).getByLabelText('Service')).toHaveValue('svc1'));
    await user.click(
      await within(dialog).findByRole('radio', { name: `${formatCalendarDate(TOMORROW)}: 4 free` }),
    );
    await user.click(await within(dialog).findByRole('radio', { name: '9:30 AM' }));
    await user.type(within(dialog).getByLabelText(/Reason for visit/), 'Fever for 3 days');
    const callsBefore = slotCalls;
    await user.click(within(dialog).getByRole('button', { name: 'Book appointment' }));

    // Taken meanwhile: the message shows, the times reload, the patient stays chosen.
    expect(
      await within(dialog).findByText('This slot was just taken. Please pick another time.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(slotCalls).toBe(callsBefore + 1)); // refreshed once
    await waitFor(() =>
      expect(within(dialog).queryByRole('radio', { name: '9:30 AM' })).not.toBeInTheDocument(),
    );
    expect(within(dialog).getByText('Priya Sharma')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: '9:45 AM' }));
    await user.click(within(dialog).getByRole('button', { name: 'Book appointment' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({
      patientId: 'p1',
      doctorId: 'dr1',
      serviceId: 'svc1',
      startAt: at(TOMORROW, '09:45'),
      type: 'new',
      reason: 'Fever for 3 days',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('asks for the patient, doctor and time before booking', async () => {
    catalogHandlers();
    server.use(http.get(url('/appointments/calendar'), () => ok([])));
    renderRoutes(routes, '/reception/appointments', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Book appointment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Book appointment' });
    await user.click(within(dialog).getByRole('button', { name: 'Book appointment' }));
    expect(await within(dialog).findByText('Choose a patient')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Doctor')).toHaveAccessibleDescription('Choose a doctor');
  });
});

describe('Appointment details page', () => {
  let current: Appointment;
  let calls: { path: string; body: unknown }[];
  beforeEach(() => {
    // Started a minute ago today, still scheduled: check-in and no-show are both possible.
    current = appointment({
      startAt: new Date(Date.now() - 60_000).toISOString(),
      endAt: new Date(Date.now() + 14 * 60_000).toISOString(),
    });
    calls = [];
    server.use(
      http.get(url('/appointments/a1'), () => ok(current)),
      http.post(url('/appointments/a1/:action'), async ({ params, request }) => {
        calls.push({ path: String(params.action), body: await request.json() });
        if (params.action === 'check-in') {
          current = { ...current, status: 'checked_in', tokenNumber: 7 };
        }
        if (params.action === 'cancel') current = { ...current, status: 'cancelled' };
        return ok(current);
      }),
    );
  });

  it('shows the details and only the actions valid now', async () => {
    renderRoutes(routes, '/reception/appointments/a1', authState(reception));
    expect(
      await screen.findByRole('heading', { name: 'Appointment APT-2026-000045' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Priya Sharma' })).toHaveAttribute(
      'href',
      '/reception/patients/p1',
    );
    expect(screen.getByText('Fever for 3 days')).toBeInTheDocument();
    for (const name of [
      'Check in',
      'Reschedule',
      'Change priority',
      'Cancel appointment',
      'Mark no-show',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Undo no-show' })).not.toBeInTheDocument();
  });

  it('check in asks first, then updates the status', async () => {
    renderRoutes(routes, '/reception/appointments/a1', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Check in' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check in' });
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(calls).toEqual([{ path: 'check-in', body: {} }]));
    expect(await screen.findAllByText('Checked in')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
  });

  it('shows server errors in the dialog', async () => {
    server.use(
      http.post(url('/appointments/a1/check-in'), () =>
        fail(
          409,
          'INVALID_STATUS_TRANSITION',
          'This appointment is cancelled and cannot be changed to checked in',
        ),
      ),
    );
    renderRoutes(routes, '/reception/appointments/a1', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Check in' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check in' });
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    expect(
      await within(dialog).findByText(/cancelled and cannot be changed to checked in/),
    ).toBeInTheDocument();
  });

  it('cancelling needs a reason', async () => {
    renderRoutes(routes, '/reception/appointments/a1', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel appointment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel APT-2026-000045' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));
    expect(calls).toEqual([]);
    await user.type(within(dialog).getByLabelText('Reason for cancelling'), 'Patient called');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));
    await waitFor(() =>
      expect(calls).toEqual([{ path: 'cancel', body: { reason: 'Patient called' } }]),
    );
  });

  it('admins see no check-in or no-show', async () => {
    renderRoutes(routes, '/admin/appointments/a1', authState(makeUser('admin')));
    expect(await screen.findByRole('button', { name: 'Reschedule' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark no-show' })).not.toBeInTheDocument();
  });
});

describe('Leave impact', () => {
  it('lists the booked appointments the new leave affects, with links', async () => {
    const doctor = makeUser('doctor', { id: 'dr1', firstName: 'Anil', lastName: 'Mehta' });
    server.use(
      http.get(url('/doctors/dr1/schedule'), () => ok({ current: null, upcoming: null })),
      http.get(url('/doctors/dr1/leaves'), () =>
        ok([], { meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
      ),
      http.post(url('/doctors/dr1/leaves'), () =>
        ok(
          {
            leave: {},
            affectedAppointments: [
              {
                id: 'a1',
                appointmentNumber: 'APT-2026-000045',
                status: 'scheduled',
                startAt: at(TOMORROW, '09:30'),
                endAt: at(TOMORROW, '09:45'),
                patientShortName: 'Priya S.',
              },
            ],
          },
          { status: 201 },
        ),
      ),
    );
    renderRoutes(routes, '/doctor/schedule', authState(doctor));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Leave' }));
    await user.click((await screen.findAllByRole('button', { name: 'Add leave' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add leave' });
    fireEvent.change(within(dialog).getByLabelText('First day'), { target: { value: TOMORROW } });
    await user.click(within(dialog).getByRole('button', { name: 'Add leave' }));
    expect(await screen.findByText('1 booked appointment falls in this leave')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'APT-2026-000045' })).toHaveAttribute(
      'href',
      '/doctor/appointments/a1',
    );
    expect(screen.getByText(/Priya S\./)).toBeInTheDocument();
  });
});
