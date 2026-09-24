import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { Encounter } from '../src/features/encounters/api';
import type { PrintSheet, Prescription } from '../src/features/prescriptions/api';
import { routes } from '../src/routes/routes';
import { appointment } from './appointments.fixtures';
import { doctorView, listOf, prescription, signableNote } from './encounters.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

/** The prescription editor, allergy acknowledgement and the print page (spec §4.7, §8.6, §12.3). */

const doctor = makeUser('doctor', { id: 'dr1', firstName: 'Anil', lastName: 'Mehta' });

const amoxicillinDraft = (acknowledged: boolean): Prescription =>
  prescription({
    items: [
      {
        ...prescription().items[0]!,
        drugName: 'Amoxicillin',
        genericName: 'Amoxicillin',
        strength: '500 mg',
        allergyWarning: {
          substance: 'Penicillin',
          matchedOn: 'class',
          drugClass: 'Penicillins',
          acknowledged,
          acknowledgedBy: acknowledged ? 'dr1' : null,
          acknowledgedAt: acknowledged ? '2026-10-01T05:00:00.000Z' : null,
        },
      },
    ],
    allergyWarnings: [
      {
        itemIndex: 0,
        drugName: 'Amoxicillin',
        substance: 'Penicillin',
        matchedOn: 'class',
        drugClass: 'Penicillins',
        acknowledged,
      },
    ],
  });

/** Workspace handlers for a1/e1 with a mutable current prescription; returns the PUT bodies. */
function workspace(note: Encounter, initialRx: Prescription | null) {
  let rx = initialRx;
  const puts: Record<string, unknown>[] = [];
  server.use(
    http.get(url('/appointments/a1'), () =>
      ok(appointment({ id: 'a1', status: 'in_consultation' })),
    ),
    http.get(url('/appointments/a1/encounter'), () => ok(note)),
    http.get(url('/patients/p1'), () => ok(doctorView())),
    http.get(url('/encounters'), () => ok([], { meta: listOf([]).meta })),
    http.get(url('/prescriptions'), ({ request }) => {
      const onNote = new URL(request.url).searchParams.get('encounter') === 'e1';
      const items = rx && onNote ? [{ ...rx, itemCount: rx.items.length }] : [];
      return ok(items, { meta: listOf(items).meta });
    }),
    http.get(url('/prescriptions/rx1'), () => (rx ? ok(rx) : fail(404, 'NOT_FOUND'))),
    http.put(url('/encounters/e1/prescription'), async ({ request }) => {
      const body = (await request.json()) as {
        items: { drugName: string; acknowledgeAllergy?: boolean }[];
      };
      puts.push(body);
      const base = rx ?? prescription({ items: [] });
      const acked = body.items[0]?.acknowledgeAllergy === true;
      const echo = (draft: Prescription): Prescription => {
        const { acknowledgeAllergy: _a, ...sent } = body.items[0] as Record<string, unknown>;
        return {
          ...draft,
          items: [{ ...draft.items[0]!, ...(sent as object) } as Prescription['items'][number]],
        };
      };
      rx =
        body.items[0]?.drugName === 'Amoxicillin'
          ? { ...echo(amoxicillinDraft(acked)), revision: (base.revision ?? 0) + 1 }
          : {
              ...base,
              revision: (base.revision ?? 0) + (rx ? 1 : 0),
              items: body.items.map((i) => ({
                ...prescription().items[0]!,
                ...(i as object),
                allergyWarning: null,
              })) as Prescription['items'],
            };
      return ok(rx);
    }),
    http.get(url('/formulary'), () =>
      ok([
        {
          name: 'Amoxicillin',
          genericName: 'Amoxicillin',
          strengths: ['250 mg', '500 mg'],
          forms: ['capsule'],
          route: 'oral',
          doseHint: '1 capsule',
          frequencyHint: 'TDS',
          frequencyHintLabel: 'Three times a day',
        },
      ]),
    ),
  );
  return { puts };
}

const open = () => renderRoutes(routes, '/doctor/consult/a1', authState(doctor));

describe('Prescription editor', () => {
  it('a formulary pick fills the generic name and hints; frequency "other" needs text', async () => {
    const { puts } = workspace(signableNote(), null);
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Prescription' }, { timeout: 5000 }));
    expect(
      screen.getByText(/convenience check, not clinical decision support/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add drug' }));
    await user.type(screen.getByRole('combobox', { name: 'Drug' }), 'amox');
    await user.click(await screen.findByRole('option', { name: /Amoxicillin/ }));
    expect(screen.getByLabelText('Generic name')).toHaveValue('Amoxicillin');
    expect(screen.getByLabelText('Strength')).toHaveValue('250 mg');
    expect(screen.getByLabelText('Dose')).toHaveValue('1 capsule');
    expect(screen.getByLabelText('Frequency')).toHaveValue('TDS');
    expect(screen.getByRole('option', { name: 'TDS – Three times a day' })).toBeInTheDocument();

    // The row is complete: leaving a field saves it.
    await user.click(screen.getByLabelText('Quantity'));
    await user.tab();
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).not.toHaveProperty('expectedVersion'); // no draft existed yet

    await user.selectOptions(screen.getByLabelText('Frequency'), 'other');
    expect(await screen.findByText('Describe the frequency')).toBeInTheDocument();
    await user.tab();
    // Nothing is saved while a row is incomplete.
    await new Promise((r) => setTimeout(r, 300));
    expect(puts).toHaveLength(1);
    await user.type(screen.getByLabelText('Frequency (describe)'), 'Every 6 hours');
    expect(screen.getByLabelText('Prescription preview')).toHaveTextContent(
      '1. Amoxicillin 250 mg – 1 capsule, Every 6 hours',
    );
    await user.tab();
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({
      expectedVersion: 1, // the revision the first save returned
      items: [
        {
          drugName: 'Amoxicillin',
          genericName: 'Amoxicillin',
          frequency: 'other',
          frequencyText: 'Every 6 hours',
        },
      ],
    });
  });

  it('rows can be reordered and removed', async () => {
    workspace(signableNote(), null);
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Prescription' }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: 'Add drug' }));
    await user.click(screen.getByRole('button', { name: 'Add drug' }));
    const drugs = screen.getAllByRole('combobox', { name: 'Drug' });
    await user.type(drugs[0]!, 'First');
    await user.type(drugs[1]!, 'Second');
    await user.click(screen.getByRole('button', { name: 'Move drug 2 up' }));
    expect(
      screen.getAllByRole('combobox', { name: 'Drug' }).map((d) => (d as HTMLInputElement).value),
    ).toEqual(['Second', 'First']);
    await user.click(screen.getByRole('button', { name: 'Remove drug 1' }));
    expect(screen.getAllByRole('combobox', { name: 'Drug' })).toHaveLength(1);
  });

  it('an allergy warning blocks signing until acknowledged', async () => {
    const { puts } = workspace(signableNote(), amoxicillinDraft(false));
    let signCalls = 0;
    server.use(
      http.post(url('/encounters/e1/sign'), () => {
        signCalls += 1;
        return fail(422, 'ALLERGY_ACK_REQUIRED', 'Some drugs match a recorded allergy.', [
          { field: 'prescription.items.0', message: 'Acknowledge the allergy warning' },
        ]);
      }),
    );
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Prescription' }, { timeout: 5000 }));
    const warning = await screen.findByRole('group', { name: 'Allergy warning' });
    expect(warning).toHaveTextContent('Matches the recorded allergy “Penicillin” (Penicillins)');

    await user.click(screen.getByRole('button', { name: /Review & sign/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Review and sign' });
    expect(
      within(dialog).getByText(/matches the recorded allergy "Penicillin"/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Sign note/ })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

    await user.click(
      within(warning).getByRole('checkbox', { name: 'I have reviewed this allergy warning' }),
    );
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      expectedVersion: 0,
      items: [{ drugName: 'Amoxicillin', acknowledgeAllergy: true }],
    });

    await user.click(screen.getByRole('button', { name: /Review & sign/ }));
    dialog = await screen.findByRole('dialog', { name: 'Review and sign' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /Sign note/ })).toBeEnabled(),
    );
    // The server has the last word: its 422 is shown with a link to the drug.
    await user.click(within(dialog).getByRole('button', { name: /Sign note/ }));
    expect(
      await within(dialog).findByRole('button', { name: 'Prescription item 1' }),
    ).toBeInTheDocument();
    expect(signCalls).toBe(1);
  });
});

const sheet = (over: Partial<PrintSheet> = {}): PrintSheet => {
  const { doctor: _d, ...rx } = prescription({
    status: 'issued',
    prescriptionNumber: 'RX-2026-000009',
    issuedAt: '2026-10-01T05:00:00.000Z',
    generalInstructions: 'Drink plenty of fluids',
  });
  return {
    ...rx,
    clinic: {
      name: 'MedAssist Clinic',
      address: {
        line1: '1 MG Road',
        line2: null,
        city: 'Bengaluru',
        state: null,
        postalCode: null,
        country: 'India',
      },
      phone: '+918041234567',
      email: 'hello@medassist.dev',
      registrationNumber: 'KA-CLINIC-77',
      gstin: '29ABCDE1234F1Z5',
    },
    doctor: {
      id: 'dr1',
      name: 'Anil Mehta',
      qualifications: ['MBBS', 'MD (Medicine)'],
      specialization: 'General Physician',
      registrationNumber: 'KMC-1234',
    },
    visitAt: '2026-10-01T04:30:00.000Z',
    followUp: { required: true, afterDays: 5, date: null, instructions: 'If fever persists' },
    ...over,
  };
};

describe('Print page', () => {
  it('prints the sheet with words for frequency and timing; diagnosis off by default (doctor toggle)', async () => {
    server.use(
      http.get(url('/prescriptions/rx1/print'), () => ok(sheet())),
      http.get(url('/encounters/e1'), () => ok(signableNote({ status: 'signed' }))),
    );
    renderRoutes(routes, '/print/prescriptions/rx1', authState(doctor));
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Prescribed drugs' }, { timeout: 5000 });
    expect(within(table).getByText('Three times a day')).toBeInTheDocument();
    expect(within(table).getByText('After food')).toBeInTheDocument();
    expect(screen.getByText('MD (Medicine)', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Reg\. no\. KMC-1234/)).toBeInTheDocument();
    expect(screen.getByText(/GSTIN 29ABCDE1234F1Z5/)).toBeInTheDocument();
    expect(screen.getByText('Follow-up after 5 days – If fever persists')).toBeInTheDocument();
    expect(screen.getByText('RX-2026-000009')).toBeInTheDocument();
    // No app chrome on the print page.
    expect(screen.queryByRole('navigation', { name: /main/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Diagnosis:/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Show diagnosis' }));
    expect(await screen.findByText(/Viral fever \(B34\.9\)/)).toBeInTheDocument();

    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('patients and reception get no diagnosis toggle', async () => {
    server.use(http.get(url('/prescriptions/rx1/print'), () => ok(sheet())));
    for (const role of ['patient', 'receptionist'] as const) {
      const { unmount } = renderRoutes(
        routes,
        '/print/prescriptions/rx1',
        authState(makeUser(role, { patientId: role === 'patient' ? 'p1' : null })),
      );
      await screen.findByRole('table', { name: 'Prescribed drugs' }, { timeout: 5000 });
      expect(screen.queryByRole('switch', { name: 'Show diagnosis' })).not.toBeInTheDocument();
      unmount();
    }
  });
});
