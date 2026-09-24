import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { attachInvalidation } from '../src/app/socketInvalidation';
import type { Queue, QueueItem } from '../src/features/queue/api';
import { routes } from '../src/routes/routes';
import { appointment, at, calendarEvent, DOCTORS, TODAY } from './appointments.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

const reception = makeUser('receptionist');
const meta = (total: number) => ({ page: 1, limit: 100, total, totalPages: 1 });

const item = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  appointmentId: 'q5',
  appointmentNumber: 'APT-2026-000105',
  tokenNumber: 5,
  status: 'checked_in',
  patient: { id: 'p5', shortName: 'Rahul V.', mrn: 'MRN-000005' },
  priority: 'normal',
  type: 'new',
  isOverbook: false,
  scheduledAt: at(TODAY, '09:30'),
  checkedInAt: at(TODAY, '09:20'),
  calledAt: null,
  startedAt: null,
  completedAt: null,
  waitMinutes: 12,
  position: 1,
  estimatedWaitMinutes: 15,
  ...overrides,
});

const queue = (overrides: Partial<Queue> = {}): Queue => ({
  doctor: { id: 'dr1', name: 'Anil Mehta', roomNumber: '101' },
  date: TODAY,
  averageConsultMinutes: 15,
  averageBasis: 'slot',
  waiting: [],
  inConsultation: [],
  done: [],
  ...overrides,
});

/** A stand-in socket to push server events into the app's invalidation. */
function fakeSocket() {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    on(event: string, fn: (payload: unknown) => void) {
      listeners.set(event, fn);
      return this;
    },
    off() {
      return this;
    },
    emit: (event: string, payload: unknown) => listeners.get(event)?.(payload),
  };
}

describe('Reception queue', () => {
  it('columns update when a socket event invalidates the queue', async () => {
    let current = queue({
      waiting: [
        item(),
        item({
          appointmentId: 'q6',
          tokenNumber: 6,
          position: 2,
          patient: { id: 'p6', shortName: 'Meera N.', mrn: 'MRN-000006' },
        }),
      ],
    });
    server.use(
      http.get(url('/doctors'), () => ok(DOCTORS, { meta: meta(2) })),
      http.get(url('/queue'), () => ok(current)),
      http.get(url('/appointments'), () => ok([], { meta: meta(0) })),
    );
    const { store } = renderRoutes(routes, '/reception/queue?doctor=dr1', authState(reception));
    const waiting = await screen.findByRole('region', { name: 'Waiting (2)' }, { timeout: 5000 });
    expect(within(waiting).getByRole('article', { name: 'Token 5, Rahul V.' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'In consultation (0)' })).toBeInTheDocument();

    // The doctor calls token 5: the server says the queue changed.
    current = queue({
      waiting: [
        item({
          appointmentId: 'q6',
          tokenNumber: 6,
          position: 1,
          patient: { id: 'p6', shortName: 'Meera N.', mrn: 'MRN-000006' },
        }),
      ],
      inConsultation: [
        item({ status: 'in_consultation', startedAt: at(TODAY, '09:40'), position: null }),
      ],
    });
    const socket = fakeSocket();
    attachInvalidation(socket as never, store.dispatch);
    socket.emit('queue.updated', { doctorId: 'dr1', date: TODAY });

    const withDoctor = await screen.findByRole('region', { name: 'In consultation (1)' });
    expect(
      within(withDoctor).getByRole('article', { name: 'Token 5, Rahul V.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Waiting (1)' })).toBeInTheDocument();
  });

  it("checks in today's booked patients and shows the token", async () => {
    let checkedIn = false;
    server.use(
      http.get(url('/doctors'), () => ok(DOCTORS, { meta: meta(2) })),
      http.get(url('/queue'), () => ok(queue())),
      http.get(url('/appointments'), () =>
        ok(checkedIn ? [] : [appointment({ startAt: at(TODAY, '11:00') })], {
          meta: meta(checkedIn ? 0 : 1),
        }),
      ),
      http.post(url('/appointments/a1/check-in'), () => {
        checkedIn = true;
        return ok(appointment({ status: 'checked_in', tokenNumber: 7 }));
      }),
    );
    renderRoutes(routes, '/reception/queue?doctor=dr1', authState(reception));
    const user = userEvent.setup();
    const table = await screen.findByRole(
      'table',
      { name: "Today's appointments" },
      { timeout: 5000 },
    );
    await user.click(within(table).getByRole('button', { name: 'Check in' }));
    expect(
      await screen.findByText('Everyone booked for today has checked in.'),
    ).toBeInTheDocument();
  });
});

describe('Doctor queue', () => {
  it('Call next is disabled while a patient is with the doctor; Complete asks first', async () => {
    const doctor = makeUser('doctor', { id: 'dr1' });
    let completed = false;
    server.use(
      http.get(url('/queue'), () =>
        ok(
          completed
            ? queue({ waiting: [item()] })
            : queue({
                waiting: [item()],
                inConsultation: [
                  item({
                    appointmentId: 'q4',
                    tokenNumber: 4,
                    status: 'in_consultation',
                    startedAt: at(TODAY, '09:10'),
                    patient: { id: 'p4', shortName: 'Asha K.', mrn: 'MRN-000004' },
                  }),
                ],
              }),
        ),
      ),
      http.post(url('/appointments/q4/complete'), () => {
        completed = true;
        return ok(appointment({ id: 'q4', status: 'completed' }));
      }),
      http.post(url('/queue/call-next'), () =>
        ok(appointment({ id: 'q5', status: 'in_consultation', tokenNumber: 5 })),
      ),
    );
    renderRoutes(routes, '/doctor/queue', authState(doctor));
    const user = userEvent.setup();
    expect(await screen.findByText('Asha K.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Call next' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Complete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete consultation' });
    await user.click(within(dialog).getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Call next' })).toBeEnabled());
  });
});

describe('Appointment drawer actions by status', () => {
  const started = () => new Date(Date.now() - 60_000).toISOString();
  const cases = [
    {
      status: 'scheduled',
      buttons: ['Check in', 'Reschedule', 'Change priority', 'Cancel appointment', 'Mark no-show'],
    },
    { status: 'checked_in', buttons: ['Change priority', 'Cancel appointment'] },
    { status: 'in_consultation', buttons: [] },
    { status: 'completed', buttons: [] },
    { status: 'cancelled', buttons: [] },
    { status: 'no_show', buttons: ['Undo no-show'] },
  ] as const;
  const ALL = [
    'Check in',
    'Reschedule',
    'Change priority',
    'Cancel appointment',
    'Mark no-show',
    'Undo no-show',
    'Start consultation',
    'Complete',
  ];

  for (const { status, buttons } of cases) {
    it(`${status}: ${buttons.join(', ') || 'no actions'}`, async () => {
      server.use(
        http.get(url('/doctors'), () => ok(DOCTORS, { meta: meta(2) })),
        http.get(url('/appointments/calendar'), () => ok([calendarEvent({ status })])),
        http.get(url('/appointments/a1'), () => ok(appointment({ status, startAt: started() }))),
      );
      renderRoutes(routes, '/reception/appointments', authState(reception));
      const user = userEvent.setup();
      await user.click(await screen.findByText('000045 · Priya S.', {}, { timeout: 5000 }));
      const drawer = await screen.findByRole('dialog', { name: 'Appointment APT-2026-000045' });
      await within(drawer).findByText('Fever for 3 days');
      for (const name of ALL) {
        const expected = (buttons as readonly string[]).includes(name);
        const found = within(drawer).queryByRole('button', { name });
        expect(Boolean(found), `${name} for ${status}`).toBe(expected);
      }
    });
  }
});

describe('Queue board (kiosk)', () => {
  it('shows tokens, doctors and rooms – never patient names, even if the API sent them', async () => {
    server.use(
      http.get(url('/queue/board'), () =>
        ok({
          date: TODAY,
          updatedAt: new Date().toISOString(),
          doctors: [
            {
              doctorName: 'Anil Mehta',
              roomNumber: '101',
              nowServing: 4,
              next: [5, 6, 7],
              waitingCount: 3,
              // Must never reach the screen:
              patientName: 'Zelda Quinn',
              current: { patient: 'Rahul Verma', mrn: 'MRN-000005' },
            },
          ],
        }),
      ),
    );
    renderRoutes(routes, '/queue-board?key=kiosk-key-123', authState(null));
    expect(await screen.findByText('Anil Mehta', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Room 101')).toBeInTheDocument();
    expect(screen.getByLabelText('Now serving token 4')).toHaveTextContent('4');
    expect(screen.getByLabelText('Next tokens 5, 6, 7')).toBeInTheDocument();
    expect(screen.getByLabelText('Clinic time')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Zelda|Quinn|Rahul|Verma|MRN-/);
    // Public page: no app shell.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('a missing or wrong key shows a simple error screen', async () => {
    renderRoutes(routes, '/queue-board', authState(null));
    expect(
      await screen.findByText(/needs its kiosk link/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();

    // A wrong key is not an expired session: no refresh (it used to loop refresh → logout → refetch).
    let refreshes = 0;
    server.use(
      http.get(url('/queue/board'), () => fail(401, 'UNAUTHORIZED', 'Invalid kiosk key')),
      http.post(url('/auth/refresh'), () => {
        refreshes += 1;
        return fail(401, 'SESSION_REVOKED', 'No active session');
      }),
    );
    renderRoutes(routes, '/queue-board?key=wrong', authState(null));
    expect(await screen.findByText('The kiosk key is not valid.')).toBeInTheDocument();
    expect(refreshes).toBe(0);
  });
});

describe('Patient dashboard token card', () => {
  it('shows the token, patients ahead and the estimated wait while checked in', async () => {
    const patient = makeUser('patient', { patientId: 'p1', patientLinkStatus: 'linked' });
    server.use(
      http.get(url('/queue/my-position'), () =>
        ok({
          appointmentId: 'a1',
          appointmentNumber: 'APT-2026-000045',
          tokenNumber: 8,
          status: 'checked_in',
          position: 3,
          patientsAhead: 2,
          estimatedWaitMinutes: 30,
          doctor: { id: 'dr1', name: 'Anil Mehta', roomNumber: '101' },
          checkedInAt: at(TODAY, '09:00'),
        }),
      ),
      http.get(url('/appointments'), () => ok([], { meta: meta(0) })),
      http.get(url('/patients/me'), () =>
        ok({ id: 'p1', mrn: 'MRN-000042', fullName: 'Priya Sharma' }),
      ),
    );
    renderRoutes(routes, '/patient/dashboard', authState(patient));
    expect(await screen.findByLabelText('Token 8', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('2 patients ahead of you')).toBeInTheDocument();
    expect(screen.getByText('Estimated wait: about 30 min')).toBeInTheDocument();
    expect(screen.getByText('No upcoming appointments.', { exact: false })).toBeInTheDocument();
  });
});
