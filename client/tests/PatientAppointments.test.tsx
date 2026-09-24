import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { addDaysToDate, formatCalendarDate } from '../src/utils/dates';
import { appointment, at, DEPARTMENTS, DOCTORS, SERVICES, TOMORROW } from './appointments.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, PUBLIC_SETTINGS, server, url } from './msw/server';

const patient = makeUser('patient', {
  patientId: 'p1',
  patientLinkStatus: 'linked',
  firstName: 'Priya',
});
const meta = (total: number) => ({ page: 1, limit: 100, total, totalPages: 1 });

function bookingHandlers(posts: unknown[], answer: (n: number) => Response) {
  server.use(
    http.get(url('/departments'), () => ok(DEPARTMENTS, { meta: meta(2) })),
    http.get(url('/doctors'), ({ request }) => {
      const dep = new URL(request.url).searchParams.get('department');
      const items = DOCTORS.filter((d) => !dep || d.department.id === dep);
      return ok(items, { meta: meta(items.length) });
    }),
    http.get(url('/services'), () => ok(SERVICES, { meta: meta(SERVICES.length) })),
    http.get(url('/doctors/dr1/availability'), ({ request }) => {
      const from = new URL(request.url).searchParams.get('from')!;
      return ok({
        timezone: 'Asia/Kolkata',
        slotMinutes: 15,
        serviceMinutes: 15,
        days: Array.from({ length: 7 }, (_, i) => ({ date: addDaysToDate(from, i), freeSlots: 3 })),
      });
    }),
    http.get(url('/doctors/dr1/slots'), () => {
      // Once the booking of 09:30 was refused, 09:30 is gone.
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
      return answer(posts.length);
    }),
    http.get(url('/appointments'), () => ok([], { meta: meta(0) })),
  );
}

/** Walks the wizard to the confirm step, picking `time`. */
async function walkTo(user: ReturnType<typeof userEvent.setup>, time: string) {
  await user.click(
    await screen.findByRole('radio', { name: /General Medicine/ }, { timeout: 5000 }),
  );
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('radio', { name: /Anil Mehta/ }));
  expect(screen.getByRole('radio', { name: /Anil Mehta/ })).toHaveTextContent('₹500.00');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(
    await screen.findByRole('radio', { name: `${formatCalendarDate(TOMORROW)}: 3 free` }),
  );
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('radio', { name: time }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('Patient booking wizard', () => {
  it('books department → doctor → date → time → reason → confirm', async () => {
    const posts: unknown[] = [];
    bookingHandlers(posts, () =>
      ok(appointment({ startAt: at(TOMORROW, '09:30') }), { status: 201 }),
    );
    const { router } = renderRoutes(routes, '/patient/appointments/book', authState(patient));
    const user = userEvent.setup();
    await walkTo(user, '9:30 AM');
    await user.type(screen.getByLabelText(/Reason for visit/), 'Fever for 3 days');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Anil Mehta (General Physician)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/patient/appointments'));
    expect(posts).toEqual([
      {
        doctorId: 'dr1',
        serviceId: 'svc1',
        startAt: at(TOMORROW, '09:30'),
        type: 'new',
        reason: 'Fever for 3 days',
      },
    ]);
  });

  it('a slot taken meanwhile sends the patient back to the times (refreshed), keeping the rest', async () => {
    const posts: unknown[] = [];
    bookingHandlers(posts, (n) =>
      n === 1
        ? fail(409, 'SLOT_UNAVAILABLE', 'This slot was just taken. Please pick another time.')
        : ok(appointment({ startAt: at(TOMORROW, '09:45') }), { status: 201 }),
    );
    const { router } = renderRoutes(routes, '/patient/appointments/book', authState(patient));
    const user = userEvent.setup();
    await walkTo(user, '9:30 AM');
    await user.type(screen.getByLabelText(/Reason for visit/), 'Skin rash');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(
      await screen.findByText('That time was just taken. Please pick another time.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Step 4 of 6: Time/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '9:30 AM' })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('radio', { name: '9:45 AM' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText(/Reason for visit/)).toHaveValue('Skin rash'); // kept
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/patient/appointments'));
    expect(posts[1]).toMatchObject({
      doctorId: 'dr1',
      startAt: at(TOMORROW, '09:45'),
      reason: 'Skin rash',
    });
  });

  it('explains a booking limit with a link to My appointments', async () => {
    bookingHandlers([], () =>
      fail(
        422,
        'BOOKING_LIMIT_REACHED',
        'You can have at most 3 upcoming appointments. Cancel one to book another.',
      ),
    );
    renderRoutes(routes, '/patient/appointments/book', authState(patient));
    const user = userEvent.setup();
    await walkTo(user, '9:30 AM');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByText(/at most 3 upcoming appointments/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See my appointments' })).toHaveAttribute(
      'href',
      '/patient/appointments',
    );
  });

  it('online booking turned off: a message instead of the wizard', async () => {
    server.use(
      http.get(url('/settings/public'), () =>
        ok({
          ...PUBLIC_SETTINGS,
          phone: '+918041234567',
          appointment: { ...PUBLIC_SETTINGS.appointment, allowPatientSelfBooking: false },
        }),
      ),
    );
    renderRoutes(routes, '/patient/appointments/book', authState(patient));
    expect(
      await screen.findByText('Online booking is turned off', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Please call the clinic on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('a pending sign-up is asked to verify first', async () => {
    renderRoutes(
      routes,
      '/patient/appointments/book',
      authState(makeUser('patient', { patientLinkStatus: 'pending_verification' })),
    );
    expect(
      await screen.findByText('Please verify your identity first', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe('My appointments (patient)', () => {
  it('offers cancel and change time only outside the cancellation window', async () => {
    const soon = appointment({
      id: 'soon',
      appointmentNumber: 'APT-2026-000001',
      startAt: new Date(Date.now() + 60 * 60_000).toISOString(), // in 1 h; the window is 2 h
      patient: undefined,
    });
    const later = appointment({
      id: 'later',
      appointmentNumber: 'APT-2026-000002',
      startAt: at(addDaysToDate(TOMORROW, 2), '10:00'),
      patient: undefined,
    });
    server.use(http.get(url('/appointments'), () => ok([soon, later], { meta: meta(2) })));
    renderRoutes(routes, '/patient/appointments', authState(patient));
    const soonCard = (await screen.findByText('APT-2026-000001', {}, { timeout: 5000 })).closest(
      'li',
    )!;
    const laterCard = screen.getByText('APT-2026-000002').closest('li')!;

    expect(within(soonCard).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(within(soonCard).queryByRole('button', { name: 'Change time' })).not.toBeInTheDocument();
    expect(within(soonCard).getByText(/please call the clinic/i)).toBeInTheDocument();

    expect(within(laterCard).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(laterCard).getByRole('button', { name: 'Change time' })).toBeInTheDocument();
  });

  it('a patient cancels their own appointment (reason optional)', async () => {
    const later = appointment({
      startAt: at(addDaysToDate(TOMORROW, 2), '10:00'),
      patient: undefined,
    });
    let body: unknown;
    server.use(
      http.get(url('/appointments'), () => ok([later], { meta: meta(1) })),
      http.post(url('/appointments/a1/cancel'), async ({ request }) => {
        body = await request.json();
        return ok({ ...later, status: 'cancelled' });
      }),
    );
    renderRoutes(routes, '/patient/appointments', authState(patient));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel appointment' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));
    await waitFor(() => expect(body).toEqual({}));
  });
});
