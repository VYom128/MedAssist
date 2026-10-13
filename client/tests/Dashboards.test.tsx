import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { changeVs, compactINR, formatRate } from '../src/features/dashboards/charts';
import { routes } from '../src/routes/routes';
import { formatDateTime, formatTime } from '../src/utils/dates';
import {
  adminDashboard,
  doctorDashboard,
  patientDashboard,
  receptionDashboard,
} from './dashboards.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

/** Role dashboards (spec §14, Phase 10): real API values, one widget's failure stays local. */

/** The StatCard whose label is `label`, once it has finished loading. */
const card = async (label: string) => {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    const el = screen
      .getAllByText(label, { selector: 'p' })[0]!
      .closest('a, div.rounded-card') as HTMLElement;
    expect(el.querySelector('[role="status"]')).toBeNull();
    found = el;
  });
  return found!;
};
/** The widget section titled `title`, once it has finished loading. */
const section = async (title: string) => {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    const el = screen
      .getAllByRole('heading', { level: 2, name: title })[0]!
      .closest('section') as HTMLElement;
    expect(el.querySelector('[role="status"]')).toBeNull();
    found = el;
  });
  return found!;
};

describe('Admin dashboard', () => {
  it('shows the numbers, money from paise and the charts’ text summaries', async () => {
    renderRoutes(routes, '/admin/dashboard', authState(makeUser('admin')));
    expect(within(await card('Appointments today')).getByText('10')).toBeVisible();
    expect(within(await card('Collected today')).getByText('₹1,250.50')).toBeVisible();
    const month = await card('Collected this month');
    expect(within(month).getByText('₹12,000.00')).toBeVisible();
    // 1,200,000 vs 1,000,000 paise for the same days last month.
    expect(within(month).getByText('+20% vs last month')).toBeVisible();
    expect(within(await card('Outstanding')).getByText('₹45,500.00')).toBeVisible();
    expect(within(await card('No-show rate (30 days)')).getByText('10.0%')).toBeVisible();
    expect(within(await card('Lab turnaround (median, 30 days)')).getByText('6.5 h')).toBeVisible();
    expect(within(await card('AI calls today')).getByText('3 / 200')).toBeVisible();

    // Charts are summarised in text (and status counts have a numeric legend).
    const revenue = await section('Revenue, last 30 days');
    expect(within(revenue).getByText(/Total ₹15,750.50 in 30 days/)).toBeInTheDocument();
    const today = await section('Appointments today');
    expect(
      within(today).getByText(
        '10 appointments today: Scheduled 4, Checked in 2, Completed 3, No-show 1.',
      ),
    ).toBeInTheDocument();
    const util = await section('Doctor utilisation, last 30 days');
    expect(within(util).getByText('Dr Asha Mehta 80%, Dr Ravi Iyer 45%')).toBeInTheDocument();
    const alerts = await section('Audit alerts');
    expect(within(alerts).getByText(/Access denied · patient MRN-2026-000123/)).toBeVisible();
    expect(
      within(alerts).getByText(new RegExp(formatDateTime('2026-10-13T04:30:00.000Z'))),
    ).toBeVisible();
  });

  it('one widget that cannot render shows its own error; the others still render', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    server.use(
      http.get(url('/dashboard/admin'), () => {
        calls += 1;
        // The first answer lacks the utilisation list; the retry has it.
        return ok(
          calls === 1 ? { ...adminDashboard(), doctorUtilisation: null } : adminDashboard(),
        );
      }),
    );
    renderRoutes(routes, '/admin/dashboard', authState(makeUser('admin')));
    const util = await section('Doctor utilisation, last 30 days');
    expect(await within(util).findByText('This widget could not be shown.')).toBeVisible();
    // Everything else is there.
    expect(within(await card('Collected today')).getByText('₹1,250.50')).toBeVisible();
    expect(await section('Audit alerts')).toBeVisible();

    await userEvent.click(within(util).getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(calls).toBe(2));
    // The new data renders the widget again.
    expect(await screen.findByText('Dr Asha Mehta 80%, Dr Ravi Iyer 45%')).toBeInTheDocument();
    expect(screen.queryByText('This widget could not be shown.')).not.toBeInTheDocument();
    quiet.mockRestore();
  });

  it('a failed load shows an error with retry in each widget, under the page header', async () => {
    server.use(http.get(url('/dashboard/admin'), () => fail(500, 'INTERNAL_ERROR', 'Server down')));
    renderRoutes(routes, '/admin/dashboard', authState(makeUser('admin', { firstName: 'Asha' })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Asha' })).toBeVisible();
    const errors = await screen.findAllByText('Server down');
    expect(errors.length).toBeGreaterThan(5);
    expect(within(await card('Outstanding')).getByRole('button', { name: /Retry/ })).toBeVisible();
  });
});

describe('Reception dashboard', () => {
  it('waiting, unpaid today with ₹ balances, the next two hours in clinic time', async () => {
    renderRoutes(routes, '/reception/dashboard', authState(makeUser('receptionist')));
    expect(within(await card('Waiting to be seen')).getByText('2')).toBeVisible();
    expect(within(await card('Appointments today')).getByText('6')).toBeVisible();
    const unpaid = await section('Unpaid invoices today');
    expect(within(unpaid).getByText('₹750.00')).toBeVisible();
    expect(within(unpaid).getByRole('link', { name: /INV-2026-000042/ })).toHaveAttribute(
      'href',
      '/reception/invoices/inv1',
    );
    const next = await section('Next 2 hours');
    const link = within(next).getByRole('link', { name: /Arjun Nair/ });
    expect(link).toHaveTextContent(formatTime('2026-10-13T06:30:00.000Z'));
    expect(link).toHaveTextContent('12:00 PM'); // 06:30 UTC in Asia/Kolkata
    expect(link).toHaveAttribute('href', '/reception/appointments/apt1');
  });

  it('empty lists say so', async () => {
    server.use(
      http.get(url('/dashboard/reception'), () =>
        ok(
          receptionDashboard({
            appointmentsByDoctor: [],
            upcoming: [],
            unpaidToday: { count: 0, items: [] },
          }),
        ),
      ),
    );
    renderRoutes(routes, '/reception/dashboard', authState(makeUser('receptionist')));
    expect(await screen.findByText('No more appointments in the next two hours.')).toBeVisible();
    expect(screen.getByText('Every invoice issued today is paid.')).toBeVisible();
    expect(screen.getByText('No appointments today.')).toBeVisible();
  });
});

describe('Doctor dashboard', () => {
  it('critical results first, drafts over 24 h highlighted, the next patient', async () => {
    renderRoutes(routes, '/doctor/dashboard', authState(makeUser('doctor')));
    const results = await section('Results to review');
    const rows = within(results).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Critical Patient');
    expect(within(rows[0]!).getByText('Critical')).toBeVisible();
    expect(rows[0]!.className).toContain('bg-danger-50');
    expect(within(rows[1]!).queryByText('Critical')).not.toBeInTheDocument();

    const drafts = await section('Unsigned notes');
    const old = within(drafts).getByRole('link', { name: 'Old Draft Patient' }).closest('li')!;
    expect(within(old).getByText('Over 24 h')).toBeVisible();
    expect(old.className).toContain('bg-warning-50');
    const fresh = within(drafts).getByRole('link', { name: 'Fresh Draft Patient' }).closest('li')!;
    expect(within(fresh).queryByText('Over 24 h')).not.toBeInTheDocument();
    expect(within(drafts).getByRole('link', { name: 'Old Draft Patient' })).toHaveAttribute(
      'href',
      '/doctor/consult/apt3',
    );

    const next = await section('Next patient');
    expect(within(next).getByText('Meera Joshi')).toBeVisible();
    expect(within(next).getByLabelText('Token 7')).toBeVisible();
    expect(within(await card('Results to review')).getByText('1 critical')).toBeVisible();
  });

  it('nobody waiting', async () => {
    server.use(
      http.get(url('/dashboard/doctor'), () => ok(doctorDashboard({ nextPatient: null }))),
    );
    renderRoutes(routes, '/doctor/dashboard', authState(makeUser('doctor')));
    expect(await screen.findByText('Nobody is waiting.')).toBeVisible();
  });
});

describe('Lab dashboard', () => {
  it('open orders by status with a numeric legend', async () => {
    renderRoutes(routes, '/lab/dashboard', authState(makeUser('labtech')));
    expect(within(await card('Open orders')).getByText('16')).toBeVisible();
    expect(within(await card('Waiting for your verification')).getByText('3')).toBeVisible();
    const chart = await section('Open orders by status');
    expect(
      within(chart).getByText(
        'Ordered 5, Sample collected 3, Sample rejected 1, Processing 2, Awaiting verification 4, Verified 1',
      ),
    ).toBeInTheDocument();
  });
});

describe('Patient dashboard', () => {
  const patient = makeUser('patient', { patientId: 'p1', patientLinkStatus: 'linked' });

  it('the outstanding balance (from paise) and the next appointment in clinic time', async () => {
    server.use(
      http.get(url('/queue/my-position'), () => ok(null)),
      http.get(url('/dashboard/patient'), () =>
        ok(
          patientDashboard({
            outstanding: { invoices: 2, balancePaise: 150_075 },
            nextAppointment: {
              id: 'a1',
              appointmentNumber: 'APT-2026-000200',
              startAt: '2026-10-20T04:00:00.000Z',
              status: 'scheduled',
              doctorName: 'Dr Asha Mehta',
              department: 'General Medicine',
              queue: null,
            },
          }),
        ),
      ),
    );
    renderRoutes(routes, '/patient/dashboard', authState(patient));
    const balance = await card('Outstanding balance');
    expect(within(balance).getByText('₹1,500.75')).toBeVisible();
    expect(balance).toHaveAttribute('href', '/patient/invoices');
    const next = await section('Next appointment');
    expect(within(next).getByText(formatDateTime('2026-10-20T04:00:00.000Z'))).toBeVisible();
    expect(within(next).getByText('20 Oct 2026, 9:30 AM')).toBeVisible();
  });

  it('no balance: no balance card (Phase 7 rule); nothing booked: says so', async () => {
    server.use(http.get(url('/queue/my-position'), () => ok(null)));
    renderRoutes(routes, '/patient/dashboard', authState(patient));
    expect(await screen.findByText('No upcoming appointments.')).toBeVisible();
    expect(screen.queryByText('Outstanding balance')).not.toBeInTheDocument();
  });
});

describe('formatting helpers', () => {
  it('rates, short rupees and month-on-month change', () => {
    expect(formatRate(0.1234)).toBe('12.3%');
    expect(formatRate(null)).toBe('—');
    expect(compactINR(95_000)).toBe('₹950');
    expect(compactINR(1_250_000)).toBe('₹12.5k');
    expect(compactINR(32_000_000)).toBe('₹3.2L');
    expect(changeVs(90, 100, 'last month', true)).toEqual({
      direction: 'down',
      label: '-10% vs last month',
      sentiment: 'negative',
    });
    expect(changeVs(5, 0, 'last month')).toBeUndefined();
  });
});
