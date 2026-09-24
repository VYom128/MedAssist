import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Encounter } from '../src/features/encounters/api';
import { routes } from '../src/routes/routes';
import { appointment } from './appointments.fixtures';
import { doctorView, encounter, listOf, prescription, signableNote } from './encounters.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

/** The consult workspace (spec §4.7, §13.4 #4). */

const doctor = makeUser('doctor', { id: 'dr1', firstName: 'Anil', lastName: 'Mehta' });

interface Setup {
  note?: Encounter;
  patch?: (body: Record<string, unknown>, n: number) => Response | Promise<Response>;
  rx?: ReturnType<typeof prescription> | null;
}

/** MSW handlers for appointment a1 and its note e1; returns the PATCH bodies received. */
function setup({ note = encounter(), patch, rx = null }: Setup = {}) {
  let current = note;
  const patches: Record<string, unknown>[] = [];
  server.use(
    http.get(url('/appointments/a1'), () =>
      ok(appointment({ id: 'a1', status: 'in_consultation' })),
    ),
    http.get(url('/appointments/a1/encounter'), () => ok(current)),
    http.get(url('/encounters/e1'), () => ok(current)),
    http.get(url('/patients/p1'), () => ok(doctorView())),
    http.get(url('/encounters'), () => ok([], { meta: listOf([]).meta })),
    http.get(url('/prescriptions'), ({ request }) => {
      const params = new URL(request.url).searchParams;
      const items = rx && params.get('encounter') === 'e1' ? [{ ...rx, itemCount: 1 }] : [];
      return ok(items, { meta: listOf(items).meta });
    }),
    http.get(url('/prescriptions/rx1'), () => (rx ? ok(rx) : fail(404, 'NOT_FOUND'))),
    http.patch(url('/encounters/e1'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      if (patch) return patch(body, patches.length);
      const { expectedVersion: _v, ...changes } = body;
      current = { ...current, ...(changes as Partial<Encounter>), revision: current.revision + 1 };
      if (changes.vitals) current.vitals = { ...note.vitals, ...(changes.vitals as object) };
      return ok(current);
    }),
  );
  return {
    patches,
    setCurrent: (e: Encounter) => {
      current = e;
    },
  };
}

const open = () => renderRoutes(routes, '/doctor/consult/a1', authState(doctor));
const tab = (name: string) => screen.getByRole('tab', { name });

describe('Consult workspace', () => {
  it('shows the patient header with the allergy alert, conditions and the visit reason', async () => {
    setup();
    open();
    expect(
      await screen.findByRole('heading', { name: 'Priya Sharma' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    const alert = screen.getByRole('alert', { name: 'Allergies' });
    expect(alert).toHaveTextContent('Penicillin');
    expect(screen.getByText('Hypertension')).toBeInTheDocument();
    expect(screen.getByText('Fever for 3 days')).toBeInTheDocument();
    // Lab orders and the AI summary are later phases: no tabs for them.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Vitals',
      'Notes',
      'Diagnosis & plan',
      'Prescription',
      'Follow-up',
    ]);
  });

  it('says "No known allergies" when none are recorded', async () => {
    setup();
    server.use(http.get(url('/patients/p1'), () => ok(doctorView({ allergies: [] }))));
    open();
    expect(
      await screen.findByText('No known allergies', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('tabs are keyboard-navigable', async () => {
    setup();
    open();
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: 'Vitals' }, { timeout: 5000 });
    tab('Vitals').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Notes')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Notes')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Follow-up')).toHaveAttribute('aria-selected', 'true');
  });

  it('autosaves on blur with expectedVersion, then sends the new revision', async () => {
    const { patches } = setup();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Notes' }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(/Chief complaint/), 'Cough');
    await user.tab(); // blur saves at once
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ expectedVersion: 0, chiefComplaint: 'Cough' });
    expect(await screen.findByText(/^Saved \d/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/History of present illness/), 'Since Monday');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toMatchObject({
      expectedVersion: 1,
      historyOfPresentIllness: 'Since Monday',
    });
  });

  it('autosaves 2 s after typing stops, one request at a time', async () => {
    const { patches } = setup();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Notes' }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(/Examination/), 'Chest clear');
    expect(patches).toHaveLength(0);
    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 4000 });
    expect(patches[0]).toEqual({ expectedVersion: 0, examination: 'Chest clear' });
  }, 10_000);

  it('409 CONFLICT stops autosave; "Reload latest" discards local edits after confirming', async () => {
    const { patches, setCurrent } = setup({
      patch: () => fail(409, 'CONFLICT', 'This note was changed in another tab'),
    });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Notes' }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(/Chief complaint/), 'Mine');
    await user.tab();
    expect(
      await screen.findByText('This note was changed in another tab or window'),
    ).toBeInTheDocument();
    expect(screen.getByText('Changed elsewhere – reload')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review & sign/ })).toBeDisabled();

    // No further saves while in conflict.
    await user.keyboard('{Control>}s{/Control}');
    expect(patches).toHaveLength(1);

    setCurrent(encounter({ revision: 5, chiefComplaint: 'From the other tab' }));
    await user.click(screen.getByRole('button', { name: 'Reload latest' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reload the latest version?' });
    await user.click(within(confirm).getByRole('button', { name: /Reload and discard/ }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Chief complaint/)).toHaveValue('From the other tab'),
    );
    expect(screen.queryByText('Changed elsewhere – reload')).not.toBeInTheDocument();
  });

  it('a network failure shows "Offline – retrying" and retries', async () => {
    const { patches } = setup({
      patch: (body, n) =>
        n === 1 ? HttpResponse.error() : ok({ ...encounter(), ...(body as object), revision: 1 }),
    });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Notes' }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(/Chief complaint/), 'Cough');
    await user.tab();
    expect(await screen.findByText('Offline – retrying')).toBeInTheDocument();
    await waitFor(() => expect(patches).toHaveLength(2), { timeout: 5000 });
    expect(patches[1]).toEqual({ expectedVersion: 0, chiefComplaint: 'Cough' });
    expect(await screen.findByText(/^Saved \d/)).toBeInTheDocument();
  }, 10_000);

  it('vitals: live BMI, out-of-range values are not sent, unusual values highlighted', async () => {
    const { patches } = setup();
    open();
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: 'Vitals' }, { timeout: 5000 });
    await user.type(screen.getByLabelText('Weight (kg)'), '70');
    await user.type(screen.getByLabelText('Height (cm)'), '175');
    expect(screen.getByText('22.9 kg/m²')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Pulse (/min)'), '400');
    expect(screen.getByText('Between 20 and 250')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Pulse (/min)'));
    await user.type(screen.getByLabelText('Pulse (/min)'), '120');
    expect(screen.getByText('Outside the usual range')).toBeInTheDocument();
    await user.tab();
    await waitFor(() =>
      expect(patches.some((p) => (p.vitals as { pulse?: number })?.pulse === 120)).toBe(true),
    );
    const sent = Object.assign({}, ...patches.map((p) => p.vitals));
    expect(sent).toEqual({ weightKg: 70, heightCm: 175, pulse: 120 });
    // Neither the out-of-range value nor a keystroke on the way to it ("40") was saved.
    expect(JSON.stringify(patches)).not.toMatch(/"pulse":40/);
  });

  it('warns before leaving with unsaved changes', async () => {
    setup({ patch: () => new Promise(() => undefined) }); // the save never finishes
    const { router } = open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Notes' }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(/Chief complaint/), 'Cough');
    void router.navigate('/doctor/queue');
    expect(
      await screen.findByRole('dialog', { name: 'Leave without saving?' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/doctor/consult/a1');
  });
});

describe('Review & sign', () => {
  it('client problems block signing and link to the right tab', async () => {
    setup();
    open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Review & sign/ }, { timeout: 5000 }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Review and sign' });
    expect(within(dialog).getByRole('button', { name: /Sign note/ })).toBeDisabled();
    expect(within(dialog).getByText('No vitals were recorded for this visit.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Chief complaint' }));
    await waitFor(() => expect(tab('Notes')).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByLabelText(/Chief complaint/)).toHaveFocus());
  });

  it("shows the server's 422 details as links", async () => {
    setup({ note: signableNote(), rx: prescription() });
    server.use(
      http.post(url('/encounters/e1/sign'), () =>
        fail(422, 'ALLERGY_ACK_REQUIRED', 'Some drugs match a recorded allergy.', [
          {
            field: 'prescription.items.0',
            itemIndex: 0,
            message: 'Acknowledge the allergy warning to prescribe this drug',
          },
        ]),
      ),
    );
    open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Review & sign/ }, { timeout: 5000 }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Review and sign' });
    expect(within(dialog).getByText(/Paracetamol 650 mg/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Sign note/ }));
    const link = await within(dialog).findByRole('button', { name: 'Prescription item 1' });
    await user.click(link);
    await waitFor(() => expect(tab('Prescription')).toHaveAttribute('aria-selected', 'true'));
  });

  it('after signing: toast-free summary with "Call next patient" and "Print prescription"', async () => {
    const { setCurrent } = setup({ note: signableNote(), rx: prescription() });
    let signedBody: unknown;
    server.use(
      http.post(url('/encounters/e1/sign'), async ({ request }) => {
        signedBody = await request.json();
        const signed = signableNote({
          status: 'signed',
          revision: 1,
          signedAt: '2026-10-01T05:00:00.000Z',
          signedBy: 'dr1',
        });
        setCurrent(signed);
        return ok({
          encounter: signed,
          prescription: prescription({ status: 'issued', prescriptionNumber: 'RX-2026-000009' }),
          appointment: { id: 'a1', status: 'completed' },
          warnings: [],
        });
      }),
      http.get(url('/encounters/e1/amendments'), () =>
        ok({
          encounterId: 'e1',
          currentVersion: 1,
          signedAt: '2026-10-01T05:00:00.000Z',
          amendments: [],
        }),
      ),
      http.post(url('/queue/call-next'), () =>
        ok(appointment({ id: 'a2', status: 'in_consultation' })),
      ),
      http.get(url('/appointments/a2'), () =>
        ok(appointment({ id: 'a2', status: 'in_consultation' })),
      ),
      http.get(url('/appointments/a2/encounter'), () =>
        ok(encounter({ id: 'e2', appointmentId: 'a2' })),
      ),
    );
    const { router } = open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Review & sign/ }, { timeout: 5000 }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Review and sign' });
    await user.click(within(dialog).getByRole('button', { name: /Sign note/ }));
    expect(await screen.findByText('Note signed')).toBeInTheDocument();
    expect(signedBody).toEqual({ expectedVersion: 0 });
    expect(screen.getByText(/Prescription RX-2026-000009 issued/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Print prescription/ })).toHaveAttribute(
      'href',
      '/doctor/prescriptions/rx1/print',
    );
    expect(await screen.findByText(/Signed by Dr Anil Mehta/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Call next patient/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/doctor/consult/a2'));
  });
});

describe('Signed note', () => {
  const signed = signableNote({
    status: 'amended',
    version: 2,
    revision: 3,
    signedAt: '2026-10-01T05:00:00.000Z',
    lastAmendedAt: '2026-10-02T05:00:00.000Z',
    signedBy: 'dr1',
    plan: 'Rest',
  });

  it('is read-only with version, history (before/after) and an Amend flow', async () => {
    setup({ note: signed });
    let amendBody: unknown;
    server.use(
      http.get(url('/encounters/e1/amendments'), () =>
        ok({
          encounterId: 'e1',
          currentVersion: 2,
          signedAt: '2026-10-01T05:00:00.000Z',
          amendments: [
            {
              id: 'am1',
              version: 2,
              reason: 'Corrected the plan after the call',
              changedFields: ['plan'],
              before: { plan: null },
              after: { plan: 'Rest' },
              amendedBy: { id: 'dr1', name: 'Anil Mehta' },
              amendedAt: '2026-10-02T05:00:00.000Z',
            },
          ],
        }),
      ),
      http.post(url('/encounters/e1/amendments'), async ({ request }) => {
        amendBody = await request.json();
        return ok({ ...signed, version: 3 }, { status: 201 });
      }),
    );
    open();
    const user = userEvent.setup();
    expect(await screen.findByText('Version 2', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Signed by Dr Anil Mehta/)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(await screen.findByText('Corrected the plan after the call')).toBeInTheDocument();
    expect(screen.getByText('Before:', { exact: false }).parentElement).toHaveTextContent('—');

    await user.click(screen.getByRole('button', { name: 'Amend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Amend signed note' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Advice to patient' }));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Advice to patient' }),
      'Drink fluids',
    );
    await user.type(within(dialog).getByLabelText('Reason for the amendment'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Save amendment' }));
    expect(within(dialog).getByText('At least 10 characters')).toBeInTheDocument();
    expect(amendBody).toBeUndefined();
    await user.type(within(dialog).getByLabelText('Reason for the amendment'), ' – added advice');
    await user.click(within(dialog).getByRole('button', { name: 'Save amendment' }));
    await waitFor(() =>
      expect(amendBody).toEqual({
        reason: 'short – added advice',
        changes: { adviceToPatient: 'Drink fluids' },
      }),
    );
  });
});
