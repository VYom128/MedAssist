import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { PatientVisit } from '../src/features/visits/api';
import { routes } from '../src/routes/routes';
import { addDaysToDate, formatCalendarDate } from '../src/utils/dates';
import { appointment, at, DEPARTMENTS, DOCTORS, SERVICES, TOMORROW } from './appointments.fixtures';
import { prescription } from './encounters.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

/** The patient portal (Phase 8): visit summary, prescriptions, home cards, follow-up booking. */

const patient = makeUser('patient', {
  patientId: 'p1',
  patientLinkStatus: 'linked',
  firstName: 'Priya',
});
const meta = (total: number) => ({ page: 1, limit: 20, total, totalPages: 1 });

const visit = (over: Partial<PatientVisit> = {}): PatientVisit => ({
  id: 'e1',
  encounterNumber: 'ENC-2026-000007',
  appointmentId: 'a1',
  visitAt: '2026-09-20T04:00:00.000Z',
  signedAt: '2026-09-20T04:30:00.000Z',
  status: 'signed',
  amended: false,
  doctor: { id: 'dr1', name: 'Anil Mehta' },
  department: { id: 'dep1', name: 'General Medicine' },
  vitals: {
    bpSystolic: 128,
    bpDiastolic: 82,
    pulse: 88,
    temperatureC: 38.2,
    respiratoryRate: null,
    spo2: 98,
    weightKg: null,
    heightCm: null,
    bmi: null,
  },
  diagnosisShared: false,
  diagnoses: null,
  adviceToPatient: 'Drink plenty of fluids and rest.',
  followUp: { required: true, afterDays: 7, date: null, instructions: 'Bring the reports' },
  prescriptionId: 'rx1',
  labOrders: [{ id: 'lo1', orderNumber: 'LAB-2026-000003' }],
  ...over,
});

function visitHandlers(v: PatientVisit) {
  server.use(
    http.get(url('/encounters/e1'), () => ok(v)),
    http.get(url('/invoices'), () =>
      ok([{ id: 'inv1', invoiceNumber: 'INV-2026-000004', status: 'paid' }], {
        meta: { ...meta(1), totals: { billedPaise: 0, collectedPaise: 0, outstandingPaise: 0 } },
      }),
    ),
  );
}

describe('Visit summary', () => {
  it('hides diagnoses when not shared and shows vitals, advice, follow-up and links', async () => {
    visitHandlers(visit());
    renderRoutes(routes, '/patient/visits/e1', authState(patient));
    expect(
      await screen.findByRole('heading', { name: /Visit on/ }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Diagnosis')).not.toBeInTheDocument();
    expect(screen.getByText('128/82 mmHg')).toBeInTheDocument();
    expect(screen.getByText('Drink plenty of fluids and rest.')).toBeInTheDocument();
    expect(
      screen.getByText('Your doctor would like to see you again in 7 days.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book follow-up' })).toHaveAttribute(
      'href',
      '/patient/appointments/book?doctor=dr1&followUpOf=a1',
    );
    expect(screen.getByRole('link', { name: 'Prescription' })).toHaveAttribute(
      'href',
      '/patient/prescriptions/rx1',
    );
    expect(screen.getByRole('link', { name: 'Lab report LAB-2026-000003' })).toHaveAttribute(
      'href',
      '/patient/lab-reports/lo1',
    );
    expect(await screen.findByRole('link', { name: 'Invoice INV-2026-000004' })).toHaveAttribute(
      'href',
      '/patient/invoices/inv1',
    );
  });

  it('shows the diagnoses when the doctor shared them', async () => {
    visitHandlers(
      visit({
        diagnosisShared: true,
        diagnoses: [
          { description: 'Viral fever', icd10Code: 'B34.9', type: 'provisional', isPrimary: true },
        ],
      }),
    );
    renderRoutes(routes, '/patient/visits/e1', authState(patient));
    expect(await screen.findByText('Viral fever', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Diagnosis' })).toBeInTheDocument();
  });
});

describe('My prescriptions', () => {
  it('lists active ones and shows items in plain words with a print button', async () => {
    const rx = prescription({
      id: 'rx1',
      status: 'issued',
      prescriptionNumber: 'RX-2026-000009',
      issuedAt: '2026-09-20T05:00:00.000Z',
    });
    const params: URLSearchParams[] = [];
    server.use(
      http.get(url('/prescriptions'), ({ request }) => {
        params.push(new URL(request.url).searchParams);
        return ok([{ ...rx, itemCount: rx.items.length }], { meta: meta(1) });
      }),
      http.get(url('/prescriptions/rx1'), () =>
        ok({
          ...rx,
          items: [
            {
              ...rx.items[0]!,
              dose: '1 tablet',
              frequency: 'BD',
              frequencyLabel: 'Twice a day',
              timing: 'after_food',
              durationDays: 5,
            },
          ],
        }),
      ),
    );
    renderRoutes(routes, '/patient/prescriptions', authState(patient));
    const user = userEvent.setup();
    const table = await screen.findByRole(
      'table',
      { name: 'Active prescriptions' },
      { timeout: 5000 },
    );
    expect(params[0]?.get('status')).toBe('issued');
    await user.click(within(table).getAllByRole('link')[0]!);
    expect(
      await screen.findByText('1 tablet, twice a day, after food, for 5 days'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute(
      'href',
      '/print/prescriptions/rx1',
    );
    // The AI explanation is Phase 9: no button yet.
    expect(screen.queryByRole('button', { name: /Explain/ })).not.toBeInTheDocument();
  });
});

describe('Patient home', () => {
  it('shows a follow-up due card with "Book follow-up"; empty cards stay hidden', async () => {
    server.use(
      http.get(url('/patients/me'), () => ok({ id: 'p1', mrn: 'MRN-000001', fullName: 'Priya' })),
      http.get(url('/appointments'), () => ok([], { meta: meta(0) })),
      http.get(url('/queue/my-position'), () => ok(null)),
      http.get(url('/prescriptions'), () => ok([], { meta: meta(0) })),
      http.get(url('/patients/me/follow-ups-due'), () =>
        ok([
          {
            encounterId: 'e1',
            encounterNumber: 'ENC-2026-000007',
            visitAt: '2026-09-20T04:00:00.000Z',
            doctor: { id: 'dr1', name: 'Anil Mehta' },
            department: { id: 'dep1', name: 'General Medicine' },
            dueDate: '2026-12-01',
            overdue: false,
            instructions: null,
            booking: { doctorId: 'dr1', followUpOf: 'a1', type: 'follow_up' },
          },
        ]),
      ),
    );
    renderRoutes(routes, '/patient/dashboard', authState(patient));
    expect(await screen.findByText('Follow-up due', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book follow-up' })).toHaveAttribute(
      'href',
      '/patient/appointments/book?doctor=dr1&followUpOf=a1',
    );
    expect(screen.getByText(`Due ${formatCalendarDate('2026-12-01')}`)).toBeInTheDocument();
    // No active prescriptions and no new reports: those cards are not shown.
    await waitFor(() => expect(screen.queryByText('Active prescriptions')).not.toBeInTheDocument());
    expect(screen.queryByText('New lab reports')).not.toBeInTheDocument();
    // The patient menu, in order.
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([
      'Home',
      'Appointments',
      'Visits',
      'Prescriptions',
      'Lab reports',
      'Invoices',
      'Documents',
      'Timeline',
      'My details',
    ]);
  });
});

describe('Booking a follow-up', () => {
  it('pre-fills the doctor and books a follow_up linked to the visit', async () => {
    const posts: unknown[] = [];
    const followUpService = {
      ...SERVICES[0]!,
      id: 'svc-fup',
      code: 'FUP-GEN',
      name: 'General Medicine follow-up',
      pricePaise: 30_000,
    };
    server.use(
      http.get(url('/doctors/dr1'), () => ok(DOCTORS[0])),
      http.get(url('/departments'), () => ok(DEPARTMENTS, { meta: meta(2) })),
      http.get(url('/doctors'), () => ok(DOCTORS, { meta: meta(2) })),
      http.get(url('/services'), () =>
        ok([...SERVICES, followUpService], { meta: meta(SERVICES.length + 1) }),
      ),
      http.get(url('/doctors/dr1/availability'), ({ request }) => {
        const from = new URL(request.url).searchParams.get('from')!;
        return ok({
          timezone: 'Asia/Kolkata',
          slotMinutes: 15,
          serviceMinutes: 15,
          days: Array.from({ length: 7 }, (_, i) => ({
            date: addDaysToDate(from, i),
            freeSlots: 3,
          })),
        });
      }),
      http.get(url('/doctors/dr1/slots'), () =>
        ok({
          date: TOMORROW,
          timezone: 'Asia/Kolkata',
          slotMinutes: 15,
          serviceMinutes: 15,
          slots: [{ startAt: at(TOMORROW, '09:30'), endAt: at(TOMORROW, '09:45'), label: '09:30' }],
        }),
      ),
      http.post(url('/appointments'), async ({ request }) => {
        posts.push(await request.json());
        return ok(appointment({ startAt: at(TOMORROW, '09:30') }), { status: 201 });
      }),
      http.get(url('/appointments'), () => ok([], { meta: meta(0) })),
    );
    const { router } = renderRoutes(
      routes,
      '/patient/appointments/book?doctor=dr1&followUpOf=a1',
      authState(patient),
    );
    const user = userEvent.setup();
    expect(
      await screen.findByText('Booking a follow-up visit', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    // Straight to the date step, with the doctor chosen.
    expect(screen.getByText(/Step 3 of 6: Date/)).toBeInTheDocument();
    await user.click(
      await screen.findByRole('radio', { name: `${formatCalendarDate(TOMORROW)}: 3 free` }),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('radio', { name: '9:30 AM' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Follow-up visit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/patient/appointments'));
    expect(posts).toEqual([
      {
        doctorId: 'dr1',
        serviceId: 'svc-fup',
        startAt: at(TOMORROW, '09:30'),
        type: 'follow_up',
        followUpOf: 'a1',
      },
    ]);
  });
});
