import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { presetRange, rowLabel } from '../src/features/reports/definitions';
import { routes } from '../src/routes/routes';
import { addDaysToDate, clinicDate, formatCalendarDate } from '../src/utils/dates';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

/** Reports (spec §7.18, Phase 10): filters in the URL, chart + table + totals, CSV, roles. */

const admin = makeUser('admin');
const reception = makeUser('receptionist');

const revenueRows = [
  {
    key: '2026-03-30',
    label: '2026-03-30',
    invoices: 0,
    billedPaise: 0,
    paymentsPaise: 0,
    refundsPaise: 0,
    netPaise: 0,
  },
  {
    key: '2026-03-31',
    label: '2026-03-31',
    invoices: 1,
    billedPaise: 125_050,
    paymentsPaise: 125_050,
    refundsPaise: 5_000,
    netPaise: 120_050,
  },
];

/** Answers every report; records each request's type and query. */
function reportHandler() {
  const seen: { type: string; params: URLSearchParams }[] = [];
  server.use(
    http.get(url('/reports/:type'), ({ params, request }) => {
      const type = params.type as string;
      const q = new URL(request.url).searchParams;
      seen.push({ type, params: q });
      const meta = {
        type,
        from: q.get('from'),
        to: q.get('to'),
        groupBy: q.get('groupBy') ?? 'day',
        timezone: 'Asia/Kolkata',
        generatedAt: '2026-10-13T05:00:00.000Z',
      };
      if (type === 'revenue') {
        return ok(
          {
            rows: revenueRows,
            totals: {
              key: 'total',
              label: 'Total',
              invoices: 1,
              billedPaise: 125_050,
              paymentsPaise: 125_050,
              refundsPaise: 5_000,
              netPaise: 120_050,
              outstandingPaise: 990_000,
            },
          },
          { meta },
        );
      }
      return ok(
        {
          rows: [
            {
              key: 'd1',
              label: 'Dr Asha Mehta',
              total: 5,
              scheduled: 1,
              checked_in: 0,
              in_consultation: 0,
              completed: 3,
              cancelled: 0,
              no_show: 1,
              noShow: 1,
              rate: 0.25,
            },
          ],
          totals: { key: 'total', label: 'Total', total: 5, completed: 3, noShow: 1, rate: 0.25 },
        },
        { meta },
      );
    }),
  );
  return seen;
}

describe('Reports page', () => {
  it('keeps report, range and grouping in the URL and asks the server for them', async () => {
    const seen = reportHandler();
    const { router } = renderRoutes(routes, '/admin/reports', authState(admin));
    const user = userEvent.setup();
    // Default: appointments for the last 30 days.
    await screen.findByRole('table', { name: 'Appointments report' });
    const last30 = presetRange('30d');
    expect(seen[0]).toMatchObject({ type: 'appointments' });
    expect(seen[0]!.params.get('from')).toBe(last30.from);
    expect(seen[0]!.params.get('to')).toBe(last30.to);
    expect(screen.getByRole('button', { name: /Last 30 days/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('tab', { name: 'Revenue' }));
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await user.selectOptions(screen.getByLabelText('Group by'), 'month');
    const today = clinicDate();
    await waitFor(() => {
      const q = new URLSearchParams(router.state.location.search);
      expect(Object.fromEntries(q)).toEqual({
        report: 'revenue',
        from: addDaysToDate(today, -6),
        to: today,
        groupBy: 'month',
      });
    });
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ type: 'revenue' }));
    expect(seen.at(-1)!.params.get('groupBy')).toBe('month');
  });

  it('reads the filters from the URL; money from paise, clinic dates, a totals row', async () => {
    reportHandler();
    renderRoutes(
      routes,
      '/admin/reports?report=revenue&from=2026-03-30&to=2026-03-31&groupBy=day',
      authState(admin),
    );
    const table = await screen.findByRole('table', { name: 'Revenue report' });
    expect(within(table).getByText(formatCalendarDate('2026-03-31'))).toBeVisible();
    expect(within(table).getByText('31 Mar 2026')).toBeVisible();
    expect(within(table).getAllByText('₹1,250.50').length).toBeGreaterThan(0);
    const totals = table.querySelector('tfoot')!;
    expect(within(totals).getByText('Total')).toBeVisible();
    expect(within(totals).getByText('₹1,200.50')).toBeVisible();
    expect(screen.getByText('₹9,900.00')).toBeVisible(); // outstanding now
    expect(screen.getByLabelText('From')).toHaveValue('2026-03-30');
    expect(screen.getByText(/Totals – .*Net collected: ₹1,200.50/)).toBeInTheDocument();
  });

  it('Export CSV downloads the server file under the server’s name', async () => {
    reportHandler();
    let csvQuery: URLSearchParams | null = null;
    server.use(
      http.get(url('/reports/no-shows'), ({ request }) => {
        const q = new URL(request.url).searchParams;
        if (q.get('format') !== 'csv') return undefined;
        csvQuery = q;
        return new HttpResponse('﻿Doctor,Completed\r\n', {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition':
              'attachment; filename="medassist-no-shows-2026-03-01-2026-03-31.csv"',
          },
        });
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL: revoke });
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    renderRoutes(
      routes,
      '/reception/reports?report=no-shows&from=2026-03-01&to=2026-03-31',
      authState(reception),
    );
    await screen.findByRole('table', { name: 'No-shows report' });
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(clicks).toEqual(['medassist-no-shows-2026-03-01-2026-03-31.csv']));
    expect(csvQuery!.get('from')).toBe('2026-03-01');
    expect(csvQuery!.get('groupBy')).toBe('doctor');
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it('receptionists get Appointments and No-shows only – never Revenue', async () => {
    const seen = reportHandler();
    const { router } = renderRoutes(
      routes,
      '/reception/reports?report=revenue',
      authState(reception),
    );
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Appointments', 'No-shows']);
    expect(screen.queryByRole('tab', { name: 'Revenue' })).not.toBeInTheDocument();
    await screen.findByRole('table', { name: 'Appointments report' });
    expect(seen.map((s) => s.type)).not.toContain('revenue');
    expect(router.state.location.pathname).toBe('/reception/reports');
  });

  it('lab technicians get Lab turnaround only', async () => {
    reportHandler();
    renderRoutes(routes, '/lab/reports', authState(makeUser('labtech')));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Lab turnaround']);
  });

  it('shows the server’s 366-day message as a notice', async () => {
    server.use(
      http.get(url('/reports/:type'), () =>
        fail(422, 'VALIDATION_ERROR', 'Choose at most 366 days', [
          { field: 'query.to', message: 'At most 366 days after "from"' },
        ]),
      ),
    );
    renderRoutes(routes, '/admin/reports?from=2024-01-01&to=2026-01-01', authState(admin));
    expect(await screen.findByText('Choose a shorter date range')).toBeVisible();
    expect(screen.getByText('Choose at most 366 days')).toBeVisible();
  });

  it('a backwards range is caught before asking the server', async () => {
    const seen = reportHandler();
    renderRoutes(routes, '/admin/reports?from=2026-03-10&to=2026-03-01', authState(admin));
    expect(await screen.findByText('"To" must not be before "From".')).toBeVisible();
    expect(seen).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled();
  });

  it('labels: months, methods and statuses', () => {
    expect(rowLabel({ key: '2026-03', label: '2026-03' }, 'month')).toBe('Mar 2026');
    expect(rowLabel({ key: 'upi', label: 'upi' }, 'method')).toBe('UPI');
    expect(rowLabel({ key: 'no_show', label: 'no_show' }, 'status')).toBe('No-show');
  });
});
