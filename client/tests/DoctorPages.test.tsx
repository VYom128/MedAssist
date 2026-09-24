import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { EncounterListItem } from '../src/features/encounters/api';
import { routes } from '../src/routes/routes';
import { appointment, TODAY } from './appointments.fixtures';
import { doctorView, encounter, listOf, prescription, signableNote } from './encounters.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';
import { listItem } from './patients.fixtures';

const doctor = makeUser('doctor', { id: 'dr1', firstName: 'Anil', lastName: 'Mehta' });

describe('My patients', () => {
  it('lists only the patients the server returns, with last visit and an allergy flag', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/patients'), ({ request }) => {
        params = new URL(request.url).searchParams;
        const items = [
          { ...listItem(), hasAllergies: true, lastVisitAt: '2026-09-20T05:00:00.000Z' },
          {
            ...listItem({ id: 'p2', fullName: 'Rahul Verma', mrn: 'MRN-000002' }),
            hasAllergies: false,
            lastVisitAt: null,
          },
        ];
        return ok(items, { meta: listOf(items).meta });
      }),
    );
    renderRoutes(routes, '/doctor/patients', authState(doctor));
    const table = await screen.findByRole('table', { name: 'My patients' }, { timeout: 5000 });
    expect(params?.get('scope')).toBe('mine');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Priya Sharma');
    expect(within(rows[0]!).getByText('Allergies')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Not seen yet');
    expect(within(rows[1]!).queryByText('Allergies')).not.toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Priya Sharma' })).toHaveAttribute(
      'href',
      '/doctor/patients/p1',
    );
    expect(screen.getByRole('link', { name: 'My patients' })).toBeInTheDocument(); // sidebar
    expect(screen.getByRole('link', { name: 'Notes' })).toBeInTheDocument();
  });
});

describe('Patient page (doctor)', () => {
  it('shows allergies and conditions and edits them through the clinical profile', async () => {
    let body: unknown;
    server.use(
      http.get(url('/patients/p1'), () => ok(doctorView())),
      http.get(url('/encounters'), () => {
        const items = [
          { ...encounter({ status: 'signed' }), primaryDiagnosis: 'Viral fever', updatedAt: null },
        ];
        return ok(items, { meta: listOf(items).meta });
      }),
      http.get(url('/prescriptions'), () => {
        const items = [
          {
            ...prescription({ status: 'issued', prescriptionNumber: 'RX-2026-000009' }),
            itemCount: 1,
          },
        ];
        return ok(items, { meta: listOf(items).meta });
      }),
      http.patch(url('/patients/p1/clinical-profile'), async ({ request }) => {
        body = await request.json();
        return ok(doctorView());
      }),
    );
    renderRoutes(routes, '/doctor/patients/p1', authState(doctor));
    const user = userEvent.setup();
    expect(
      await screen.findByRole('alert', { name: 'Allergies' }, { timeout: 5000 }),
    ).toHaveTextContent('Penicillin');
    expect(screen.getByText('Hypertension')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Viral fever' })).toHaveAttribute(
      'href',
      '/doctor/encounters/e1',
    );
    expect(screen.getByRole('link', { name: 'Print RX-2026-000009' })).toHaveAttribute(
      'href',
      '/print/prescriptions/rx1',
    );

    await user.click(screen.getByRole('button', { name: 'Edit allergies and conditions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Allergies and chronic conditions' });
    await user.click(within(dialog).getByRole('button', { name: 'Add condition' }));
    await user.type(within(dialog).getAllByLabelText('Condition').at(-1)!, 'Asthma');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      allergies: [{ id: 'a1', substance: 'Penicillin', severity: 'severe' }],
      chronicConditions: [
        { id: 'c1', name: 'Hypertension' },
        { name: 'Asthma', since: null },
      ],
    });
  });
});

describe('Notes', () => {
  it('lists my notes and flags drafts older than 24 h as "Unsigned"', async () => {
    let params: URLSearchParams | undefined;
    const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
    const items: EncounterListItem[] = [
      { ...encounter({ id: 'e1', visitAt: old }), updatedAt: null },
      {
        ...encounter({ id: 'e2', appointmentId: 'a2', visitAt: new Date().toISOString() }),
        updatedAt: null,
      },
      { ...signableNote({ id: 'e3', status: 'signed', version: 2 }), updatedAt: null },
    ];
    server.use(
      http.get(url('/encounters'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return ok(items, { meta: listOf(items).meta });
      }),
    );
    renderRoutes(routes, '/doctor/notes', authState(doctor));
    const table = await screen.findByRole('table', { name: 'My notes' }, { timeout: 5000 });
    expect(params?.get('mine')).toBe('true');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Unsigned')).toBeInTheDocument();
    expect(within(rows[1]!).queryByText('Unsigned')).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText('v2')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/doctor/consult/a1');
    expect(within(rows[2]!).getByRole('link')).toHaveAttribute('href', '/doctor/encounters/e3');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Drafts' }));
    await waitFor(() => expect(params?.get('status')).toBe('draft'));
  });
});

describe('Access and reception printing', () => {
  it('a receptionist cannot open the consult workspace (403 page)', async () => {
    const { router } = renderRoutes(
      routes,
      '/doctor/consult/a1',
      authState(makeUser('receptionist')),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
  });

  it('reception sees "Print prescription" on a completed appointment with an issued prescription', async () => {
    server.use(
      http.get(url('/appointments/a1'), () =>
        ok(appointment({ id: 'a1', status: 'completed', startAt: `${TODAY}T04:00:00.000Z` })),
      ),
      http.get(url('/prescriptions'), ({ request }) => {
        const onAppt = new URL(request.url).searchParams.get('appointment') === 'a1';
        const items = onAppt
          ? [
              {
                ...prescription({ status: 'issued', prescriptionNumber: 'RX-2026-000009' }),
                itemCount: 1,
              },
            ]
          : [];
        return ok(items, { meta: listOf(items).meta });
      }),
    );
    renderRoutes(routes, '/reception/appointments/a1', authState(makeUser('receptionist')));
    const link = await screen.findByRole('link', { name: /Print prescription/ }, { timeout: 5000 });
    expect(link).toHaveAttribute('href', '/print/prescriptions/rx1');
  });
});

describe('Issued prescription on a signed note', () => {
  it('Reissue asks for a reason, then the new draft is edited and issued', async () => {
    const signed = signableNote({
      status: 'signed',
      revision: 2,
      signedAt: '2026-10-01T05:00:00.000Z',
    });
    let current = prescription({ status: 'issued', prescriptionNumber: 'RX-2026-000009' });
    let reissueBody: unknown;
    let issueBody: unknown;
    server.use(
      http.get(url('/appointments/a1'), () => ok(appointment({ id: 'a1', status: 'completed' }))),
      http.get(url('/appointments/a1/encounter'), () => ok(signed)),
      http.get(url('/patients/p1'), () => ok(doctorView())),
      http.get(url('/encounters'), () => ok([], { meta: listOf([]).meta })),
      http.get(url('/encounters/e1/amendments'), () =>
        ok({ encounterId: 'e1', currentVersion: 1, signedAt: signed.signedAt, amendments: [] }),
      ),
      http.get(url('/prescriptions'), ({ request }) => {
        const onNote = new URL(request.url).searchParams.get('encounter') === 'e1';
        const items = onNote ? [{ ...current, itemCount: 1 }] : [];
        return ok(items, { meta: listOf(items).meta });
      }),
      http.get(url('/prescriptions/:id'), () => ok(current)),
      http.post(url('/prescriptions/rx1/reissue'), async ({ request }) => {
        reissueBody = await request.json();
        current = prescription({ id: 'rx2', status: 'draft', replaces: 'rx1', revision: 0 });
        return ok(current, { status: 201 });
      }),
      http.post(url('/prescriptions/rx2/issue'), async ({ request }) => {
        issueBody = await request.json();
        current = { ...current, status: 'issued', prescriptionNumber: 'RX-2026-000010' };
        return ok(current);
      }),
    );
    renderRoutes(routes, '/doctor/consult/a1', authState(doctor));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reissue' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Reissue prescription' });
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Dose to change');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel and create new draft' }));
    await waitFor(() => expect(reissueBody).toEqual({ reason: 'Dose to change' }));
    expect(await screen.findByText('New prescription (not issued yet)')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Drug' })).toHaveValue('Paracetamol');
    await user.click(screen.getByRole('button', { name: 'Issue prescription' }));
    await waitFor(() => expect(issueBody).toEqual({ expectedVersion: 0 }));
    expect(await screen.findByText('RX-2026-000010')).toBeInTheDocument();
  });
});
