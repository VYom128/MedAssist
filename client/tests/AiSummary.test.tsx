import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http } from 'msw';
import type { SummaryState } from '../src/features/ai/api';
import type { Encounter } from '../src/features/encounters/api';
import { routes } from '../src/routes/routes';
import { approvedSummary, explanation, summary, summaryState } from './ai.fixtures';
import { appointment } from './appointments.fixtures';
import { doctorView, encounter, listOf, prescription, signableNote } from './encounters.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, PUBLIC_SETTINGS, server, url } from './msw/server';

/** The AI summary in the consult workspace and the doctor's views (Phase 9, spec §9.2). */

const doctor = makeUser('doctor', { id: 'dr1', firstName: 'Anil', lastName: 'Mehta' });

const signedNote = signableNote({
  status: 'signed',
  signedAt: '2026-10-01T05:00:00.000Z',
  signedBy: 'dr1',
});
const issuedRx = prescription({
  status: 'issued',
  prescriptionNumber: 'RX-2026-000003',
  issuedAt: '2026-10-01T05:00:00.000Z',
});

/** MSW handlers for appointment a1 / note e1 and its summary; returns what the server got. */
function setup({
  note = encounter(),
  state = summaryState(),
  rx = null,
}: {
  note?: Encounter;
  state?: SummaryState;
  rx?: ReturnType<typeof prescription> | null;
} = {}) {
  let current = state;
  const sent: { patches: unknown[]; approve: unknown[]; reject: unknown[] } = {
    patches: [],
    approve: [],
    reject: [],
  };
  server.use(
    http.get(url('/appointments/a1'), () =>
      ok(
        appointment({
          id: 'a1',
          status: note.status === 'draft' ? 'in_consultation' : 'completed',
        }),
      ),
    ),
    http.get(url('/appointments/a1/encounter'), () => ok(note)),
    http.get(url('/encounters/e1'), () => ok(note)),
    http.get(url('/patients/p1'), () => ok(doctorView())),
    http.get(url('/encounters'), () => ok([], { meta: listOf([]).meta })),
    http.get(url('/lab-orders'), () => ok([], { meta: listOf([]).meta })),
    http.get(url('/prescriptions'), () => {
      const items = rx ? [{ ...rx, itemCount: 1 }] : [];
      return ok(items, { meta: listOf(items).meta });
    }),
    http.get(url('/prescriptions/rx1'), () => (rx ? ok(rx) : fail(404, 'NOT_FOUND'))),
    http.get(url('/encounters/e1/amendments'), () =>
      ok({ encounterId: 'e1', currentVersion: 1, signedAt: note.signedAt, amendments: [] }),
    ),
    http.patch(url('/encounters/e1'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.patches.push(body);
      const { expectedVersion: _v, ...changes } = body;
      return ok({ ...note, ...(changes as Partial<Encounter>), revision: note.revision + 1 });
    }),
    http.get(url('/encounters/e1/summary'), () => ok(current)),
    http.post(url('/encounters/e1/summary/s1/approve'), async ({ request }) => {
      const body = (await request.json()) as { shareWithPatient: boolean };
      sent.approve.push(body);
      const approved = approvedSummary({ shareWithPatient: body.shareWithPatient });
      current = { ...current, draft: null, approved };
      return ok(approved);
    }),
    http.post(url('/encounters/e1/summary/s1/reject'), async ({ request }) => {
      sent.reject.push(await request.json());
      current = {
        ...current,
        draft: null,
        lastAttempt: { id: 's1', status: 'rejected', errorCode: null },
      };
      return ok(summary({ status: 'rejected' }));
    }),
  );
  return sent;
}

const openConsult = () => renderRoutes(routes, '/doctor/consult/a1', authState(doctor));

/** jsdom lays nothing out: give the AI draft region a scrollable height. */
function scrollableDraft() {
  const define = (prop: 'scrollHeight' | 'clientHeight', value: number) =>
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.scrollRegion ? value : 0;
      },
    });
  define('scrollHeight', 1000);
  define('clientHeight', 300);
}
afterEach(() => {
  // Back to jsdom's own getters (on Element.prototype).
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

const draftRegion = () => screen.getByRole('region', { name: 'AI draft sections' });
const scrollToEnd = () => fireEvent.scroll(draftRegion(), { target: { scrollTop: 700 } });
const approveButton = () => screen.getByRole('button', { name: 'Approve' });

async function openAiTab() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: 'AI summary' }, { timeout: 5000 }));
  return user;
}

describe('Approve', () => {
  beforeEach(scrollableDraft);

  it('stays disabled on a draft note until the draft is read, and says the note must be signed', async () => {
    setup({ state: summaryState({ draft: summary() }) });
    openConsult();
    await openAiTab();

    expect(await screen.findByText('AI draft – review before use')).toBeInTheDocument();
    // Side by side with the note, the server's checks in plain words, the clinician flags.
    expect(screen.getByRole('heading', { name: 'Source note' })).toBeInTheDocument();
    expect(
      screen.getByText('An unverified diagnosis was removed (it was not in the note).'),
    ).toBeInTheDocument();
    expect(screen.getByText('For you to check')).toBeInTheDocument();
    expect(screen.getByLabelText('Summary text')).toHaveValue(summary().finalText);

    expect(approveButton()).toBeDisabled();
    expect(screen.getByText('Read the whole draft – scroll to its end.')).toBeInTheDocument();
    expect(screen.getByText(/Sign the note first/)).toBeInTheDocument();

    scrollToEnd();
    await waitFor(() =>
      expect(
        screen.queryByText('Read the whole draft – scroll to its end.'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Sign the note first/)).toBeInTheDocument();
    expect(approveButton()).toBeDisabled();
  });

  it('stays disabled while the summary is out of date, with Regenerate', async () => {
    setup({
      note: signedNote,
      state: summaryState({
        draft: summary({ isOutdated: true }),
        isOutdated: true,
        noteSigned: true,
      }),
    });
    openConsult();
    expect(
      await screen.findByText('Out of date – regenerate', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    scrollToEnd();
    await waitFor(() =>
      expect(
        screen.queryByText('Read the whole draft – scroll to its end.'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/Sign the note first/)).not.toBeInTheDocument();
    expect(
      screen.getByText('The note changed after this draft – regenerate it first.'),
    ).toBeInTheDocument();
    expect(approveButton()).toBeDisabled();
  });

  it('is enabled once read, signed and current; approving shares when ticked', async () => {
    const sent = setup({
      note: signedNote,
      state: summaryState({ draft: summary(), noteSigned: true }),
    });
    openConsult();
    const user = userEvent.setup();
    await screen.findByText('AI draft – review before use', {}, { timeout: 5000 });
    expect(approveButton()).toBeDisabled();
    scrollToEnd();
    await waitFor(() => expect(approveButton()).toBeEnabled());
    expect(screen.queryByText('Approve is not available yet:')).not.toBeInTheDocument();

    // Unsaved edits block approval until saved.
    await user.type(screen.getByLabelText('Summary text'), ' Edited.');
    expect(approveButton()).toBeDisabled();
    expect(screen.getByText('Save your changes to the summary text.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Summary text'));
    await user.type(screen.getByLabelText('Summary text'), summary().finalText!);
    await waitFor(() => expect(approveButton()).toBeEnabled());

    await user.click(approveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Approve the summary?' });
    await user.click(within(dialog).getByRole('checkbox', { name: /Share with patient/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(sent.approve).toEqual([{ shareWithPatient: true, expectedVersion: 0 }]),
    );

    expect(
      await screen.findByText(/^AI-assisted · reviewed by Dr Anil Mehta on /),
    ).toBeInTheDocument();
    expect(screen.getByText('Shared with patient')).toBeInTheDocument();
  });

  it('rejects with a reason', async () => {
    const sent = setup({
      note: signedNote,
      state: summaryState({ draft: summary(), noteSigned: true }),
    });
    openConsult();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reject' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject the AI draft?' });
    await user.type(
      within(dialog).getByLabelText(/Why are you rejecting it/),
      'Missed the cough history',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reject draft' }));
    await waitFor(() => expect(sent.reject).toEqual([{ reason: 'Missed the cough history' }]));
    expect(await screen.findByText(/Your last draft was rejected/)).toBeInTheDocument();
  });
});

describe('Generate', () => {
  it('shows the wait with a way to stop waiting', async () => {
    setup();
    server.use(
      http.post(url('/encounters/e1/summary/generate'), async () => {
        await delay('infinite');
        return ok(summary());
      }),
    );
    openConsult();
    const user = await openAiTab();
    await user.click(await screen.findByRole('button', { name: 'Generate summary' }));
    expect(await screen.findByText('This can take up to 30 seconds.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(await screen.findByText('Stopped waiting')).toBeInTheDocument();
  });

  it.each([
    {
      name: 'busy',
      error: () =>
        fail(503, 'AI_UNAVAILABLE', 'The AI is busy, try again in a minute', { retryAfter: 20 }),
      texts: ['The AI is busy – try again in a minute'],
      retry: true,
    },
    {
      name: 'daily limit',
      error: () =>
        fail(503, 'AI_UNAVAILABLE', 'Daily AI limit reached', {
          reason: 'daily_limit',
          limit: 300,
        }),
      texts: ['Daily AI limit reached', /available again tomorrow/],
      retry: false,
    },
    {
      name: 'invalid output',
      error: () => fail(503, 'AI_OUTPUT_INVALID', 'The AI answer could not be used'),
      texts: ["The AI summary couldn't be generated.", 'You can write the summary yourself.'],
      retry: false,
    },
  ])('$name: a plain message, and the rest of the workspace still works', async (c) => {
    const sent = setup();
    let calls = 0;
    server.use(
      http.post(url('/encounters/e1/summary/generate'), () => {
        calls += 1;
        return c.error();
      }),
    );
    openConsult();
    const user = await openAiTab();
    await user.click(await screen.findByRole('button', { name: 'Generate summary' }));
    for (const text of c.texts) expect(await screen.findByText(text)).toBeInTheDocument();
    const retry = screen.queryByRole('button', { name: 'Retry' });
    if (c.retry) {
      await user.click(retry!);
      await waitFor(() => expect(calls).toBe(2));
    } else {
      expect(retry).not.toBeInTheDocument();
    }

    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    await user.type(screen.getByLabelText(/Chief complaint/), 'Cough');
    await user.tab();
    await waitFor(() =>
      expect(sent.patches).toEqual([{ expectedVersion: 0, chiefComplaint: 'Cough' }]),
    );
  });

  it('AI_DISABLED hides the tab', async () => {
    setup();
    server.use(
      http.post(url('/encounters/e1/summary/generate'), () =>
        fail(403, 'AI_DISABLED', 'AI clinical summaries are turned off'),
      ),
    );
    openConsult();
    const user = await openAiTab();
    server.use(
      http.get(url('/settings/public'), () =>
        ok({ ...PUBLIC_SETTINGS, ai: { ...PUBLIC_SETTINGS.ai, clinicalSummaryEnabled: false } }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Generate summary' }));
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'AI summary' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: 'Vitals' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Turned off in settings', () => {
  it('hides the summary tab and the doctor’s explanation preview', async () => {
    setup({ note: signedNote, rx: issuedRx });
    server.use(
      http.get(url('/settings/public'), () =>
        ok({
          ...PUBLIC_SETTINGS,
          ai: {
            ...PUBLIC_SETTINGS.ai,
            clinicalSummaryEnabled: false,
            patientExplanationEnabled: false,
          },
        }),
      ),
    );
    renderRoutes(routes, '/doctor/encounters/e1', authState(doctor));
    expect(await screen.findByText('RX-2026-000003', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview explanation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI summary' })).not.toBeInTheDocument();
  });

  it('hides the consult tab', async () => {
    setup();
    server.use(
      http.get(url('/settings/public'), () =>
        ok({ ...PUBLIC_SETTINGS, ai: { ...PUBLIC_SETTINGS.ai, enabled: false } }),
      ),
    );
    openConsult();
    expect(
      await screen.findByRole('tab', { name: 'Vitals' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'AI summary' })).not.toBeInTheDocument();
  });
});

describe('Encounter view', () => {
  it('shows the approved summary label and a labelled explanation preview', async () => {
    setup({
      note: signedNote,
      rx: issuedRx,
      state: summaryState({
        approved: approvedSummary({ shareWithPatient: true }),
        noteSigned: true,
      }),
    });
    let body: unknown;
    server.use(
      http.post(url('/prescriptions/rx1/explain'), async ({ request }) => {
        body = await request.json();
        return ok(explanation({ preview: true, guardrailFlags: ['regenerated'] }));
      }),
    );
    renderRoutes(routes, '/doctor/encounters/e1', authState(doctor));
    const user = userEvent.setup();
    expect(
      await screen.findByText(
        /^AI-assisted · reviewed by Dr Anil Mehta on /,
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Shared with patient')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Preview explanation' }));
    const preview = await screen.findByRole('region', {
      name: 'Preview – what the patient will see',
    });
    expect(await within(preview).findByText('Take 1 tablet')).toBeInTheDocument();
    expect(body).toEqual({ language: 'en' });
    expect(
      within(preview).getByText('The first answer failed the safety checks and was written again.'),
    ).toBeInTheDocument();
    expect(within(preview).queryByText('Was this helpful?')).not.toBeInTheDocument();
  });
});
