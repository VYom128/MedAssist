import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { routes } from '../src/routes/routes';
import { appointment } from './appointments.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

/** Printing (Phase 10): the app shell and controls hide on paper; slips and visit summaries. */

const reception = makeUser('receptionist');
const patient = makeUser('patient', { patientId: 'p1', patientLinkStatus: 'linked' });
const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

describe('print styles', () => {
  it('hide the navigation, buttons and filters; show the clinic header', async () => {
    server.use(
      http.get(url('/reports/:type'), () =>
        ok({ rows: [], totals: { key: 'total', label: 'Total' } }, { meta: { groupBy: 'day' } }),
      ),
    );
    renderRoutes(routes, '/reception/reports', authState(reception));
    await screen.findByRole('heading', { level: 1, name: 'Reports' });
    const topBar = screen.getByRole('banner');
    const sidebar = screen.getAllByRole('navigation', { name: 'Main' })[0]!.closest('aside');
    const header = screen.getByTestId('print-header');
    expect({
      topBar: topBar.className.split(' ').filter((c) => c.startsWith('print:')),
      sidebar: sidebar?.className.split(' ').filter((c) => c.startsWith('print:')),
      printHeader: header.className.split(' ').filter((c) => /hidden|print:/.test(c)),
    }).toMatchInlineSnapshot(`
      {
        "printHeader": [
          "hidden",
          "print:block",
        ],
        "sidebar": [
          "print:hidden",
        ],
        "topBar": [
          "print:hidden",
        ],
      }
    `);
    await waitFor(() => expect(header).toHaveTextContent('MedAssist Clinic'));
    expect(header).toHaveTextContent(/Printed \d{2} \w{3} \d{4}/);
    // The print rules: black text, no buttons / tabs / filters, page breaks between sections.
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/color: #000000 !important/);
    expect(print).toMatch(/button,\s*\[role='tablist'\],\s*\[role='search'\]/);
    expect(print).toMatch(/\.print-section \+ \.print-section \{\s*break-before: page;/);
  });

  it('the queue and the daily appointment list have Print buttons', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    server.use(
      http.get(url('/appointments'), () =>
        ok([], { meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
      ),
      http.get(url('/doctors'), () =>
        ok([], { meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
      ),
    );
    const list = renderRoutes(routes, '/reception/appointments?view=list', authState(reception));
    await userEvent.click(await screen.findByRole('button', { name: 'Print' }, { timeout: 5000 }));
    expect(print).toHaveBeenCalledTimes(1);
    list.unmount();

    renderRoutes(routes, '/reception/queue', authState(reception));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Queue' }, { timeout: 5000 }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(2);
    print.mockRestore();
  });
});

describe('PDF buttons', () => {
  const pdf = (name: string) =>
    new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    });

  it('the patient downloads the slip of an appointment', async () => {
    const asked: string[] = [];
    server.use(
      http.get(url('/queue/my-position'), () => ok(null)),
      http.get(url('/appointments'), () =>
        ok([appointment({ id: 'a1', status: 'scheduled' })], {
          meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
        }),
      ),
      http.get(url('/appointments/:id/slip.pdf'), ({ params }) => {
        asked.push(params.id as string);
        return pdf('slip.pdf');
      }),
    );
    renderRoutes(routes, '/patient/appointments', authState(patient));
    await userEvent.click(await screen.findByRole('button', { name: /Download slip/ }));
    await waitFor(() => expect(asked).toEqual(['a1']));
  });

  it('the patient downloads the visit summary of a signed visit', async () => {
    const asked: string[] = [];
    server.use(
      http.get(url('/encounters/:id/visit-summary.pdf'), ({ params }) => {
        asked.push(params.id as string);
        return pdf('visit-summary.pdf');
      }),
      http.get(url('/encounters/e1'), () =>
        ok({
          id: 'e1',
          encounterNumber: 'ENC-2026-000007',
          appointmentId: 'a1',
          visitAt: '2026-09-20T04:00:00.000Z',
          signedAt: '2026-09-20T04:30:00.000Z',
          status: 'signed',
          amended: false,
          doctor: { id: 'dr1', name: 'Anil Mehta' },
          department: null,
          vitals: {
            bpSystolic: null,
            bpDiastolic: null,
            pulse: null,
            temperatureC: null,
            respiratoryRate: null,
            spo2: null,
            weightKg: null,
            heightCm: null,
            bmi: null,
          },
          diagnosisShared: false,
          diagnoses: null,
          adviceToPatient: null,
          followUp: { required: false, afterDays: null, date: null, instructions: null },
          prescriptionId: null,
          labOrders: [],
          aiSummary: null,
        }),
      ),
    );
    renderRoutes(routes, '/patient/visits/e1', authState(patient));
    await userEvent.click(await screen.findByRole('button', { name: /Visit summary/ }));
    await waitFor(() => expect(asked).toEqual(['e1']));
  });
});
