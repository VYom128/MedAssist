import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { Explanation } from '../src/features/ai/api';
import type { PatientVisit } from '../src/features/visits/api';
import { routes } from '../src/routes/routes';
import { explanation } from './ai.fixtures';
import { prescription } from './encounters.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, PUBLIC_SETTINGS, server, url } from './msw/server';
import { selfView } from './patients.fixtures';

/** "Explain in simple words" for patients (Phase 9, spec §4.12, §9.3). */

const patient = makeUser('patient', { patientId: 'p1', patientLinkStatus: 'linked' });
const issued = prescription({
  status: 'issued',
  prescriptionNumber: 'RX-2026-000003',
  issuedAt: '2026-10-01T05:00:00.000Z',
});

/** Handlers for prescription rx1; `answer` builds the explanation per language. */
function setup({
  answer = (language: 'en' | 'hi') => ok(explanation({ language })),
  me = selfView(),
  rx = issued,
}: {
  answer?: (language: 'en' | 'hi') => Response;
  me?: ReturnType<typeof selfView>;
  rx?: ReturnType<typeof prescription>;
} = {}) {
  const requests: string[] = [];
  const feedback: unknown[] = [];
  server.use(
    http.get(url('/prescriptions/rx1'), () => ok(rx)),
    http.get(url('/patients/me'), () => ok(me)),
    http.post(url('/prescriptions/rx1/explain'), async ({ request }) => {
      const { language } = (await request.json()) as { language: 'en' | 'hi' };
      requests.push(language);
      return answer(language);
    }),
    http.post(url('/prescriptions/rx1/explain/feedback'), async ({ request }) => {
      const body = (await request.json()) as { language: 'en' | 'hi'; helpful: boolean };
      feedback.push(body);
      return ok(
        explanation({
          language: body.language,
          feedback: { helpful: body.helpful, comment: null, at: '2026-10-12T05:00:00.000Z' },
        }),
      );
    }),
  );
  return { requests, feedback };
}

const open = () => renderRoutes(routes, '/patient/prescriptions/rx1', authState(patient));
const explainButton = () =>
  screen.findByRole('button', { name: 'Explain in simple words' }, { timeout: 5000 });

describe('Explain in simple words', () => {
  it('shows the explanation with the contact list and the disclaimer at the bottom', async () => {
    const { requests } = setup();
    server.use(
      http.get(url('/settings/public'), () => ok({ ...PUBLIC_SETTINGS, phone: '+918041234567' })),
    );
    open();
    const user = userEvent.setup({ delay: null });
    await user.click(await explainButton());
    const panel = await screen.findByRole('region', { name: 'Explained in simple words' });
    expect(await within(panel).findByText('Take 1 tablet')).toBeInTheDocument();
    expect(requests).toEqual(['en']);
    expect(within(panel).getByText('Your medicines')).toBeInTheDocument();
    expect(within(panel).getByText('When to contact the clinic')).toBeInTheDocument();
    expect(within(panel).getByText('You have trouble breathing')).toBeInTheDocument();
    expect(within(panel).getByText('How long should the fever last?')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Contact the clinic/ })).toHaveAttribute(
      'href',
      'tel:+918041234567',
    );
    expect(within(panel).queryByText('Shown in a simplified format.')).not.toBeInTheDocument();
    // The disclaimer is always the last thing in the panel and has no toggle.
    const disclaimer = within(panel).getByTestId('explanation-disclaimer');
    expect(disclaimer).toHaveTextContent(/does not replace your doctor’s advice/);
    expect(panel.lastElementChild?.lastElementChild).toBe(disclaimer);
    expect(within(panel).queryByRole('button', { name: /disclaimer/i })).not.toBeInTheDocument();
  });

  it('notes the simplified format when the template was used – disclaimer still shown', async () => {
    setup({ answer: (language) => ok(explanation({ language, isFallback: true })) });
    open();
    const user = userEvent.setup({ delay: null });
    await user.click(await explainButton());
    expect(await screen.findByText('Shown in a simplified format.')).toBeInTheDocument();
    expect(screen.getByTestId('explanation-disclaimer')).toBeInTheDocument();
  });

  it('asks again in Hindi on the language switch and renders Devanagari', async () => {
    const { requests } = setup();
    open();
    const user = userEvent.setup({ delay: null });
    await user.click(await explainButton());
    await screen.findByText('Take 1 tablet');
    await user.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(await screen.findByText('1 गोली लें')).toBeInTheDocument();
    expect(requests).toEqual(['en', 'hi']);
    expect(screen.getByText('आपकी दवाइयाँ')).toBeInTheDocument();
    expect(screen.getByText('३ दिन')).toBeInTheDocument();
    const disclaimer = screen.getByTestId('explanation-disclaimer');
    expect(disclaimer).toHaveTextContent('यह जानकारी AI ने आपके डॉक्टर के निर्देशों से लिखी है।');
    expect(disclaimer).toHaveAttribute('lang', 'hi');
    expect(screen.getByRole('button', { name: 'हिन्दी' })).toHaveAttribute('aria-pressed', 'true');
    // Back to English: answered from the cache, no new request.
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByText('Take 1 tablet')).toBeInTheDocument();
    expect(requests).toEqual(['en', 'hi']);
  });

  it('starts in the patient’s preferred language', async () => {
    const { requests } = setup({ me: selfView({ preferredLanguage: 'hi' }) });
    open();
    const user = userEvent.setup({ delay: null });
    await user.click(await explainButton());
    expect(await screen.findByText('1 गोली लें')).toBeInTheDocument();
    expect(requests).toEqual(['hi']);
  });

  it('records 👍 / 👎 with an optional comment', async () => {
    const { feedback } = setup();
    open();
    const user = userEvent.setup({ delay: null });
    await user.click(await explainButton());
    await screen.findByText('Was this helpful?');
    await user.click(screen.getByRole('button', { name: 'No' }));
    await user.type(screen.getByLabelText(/Anything to add/), 'Too long');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() =>
      expect(feedback).toEqual([{ language: 'en', helpful: false, comment: 'Too long' }]),
    );
    expect(await screen.findByText('Thank you for your feedback.')).toBeInTheDocument();
    // The explanation stays on screen.
    expect(screen.getByText('Take 1 tablet')).toBeInTheDocument();
  });

  it.each([
    {
      name: 'busy',
      error: () => fail(503, 'AI_UNAVAILABLE', 'The AI is busy, try again in a minute'),
      text: 'The AI is busy – try again in a minute.',
    },
    {
      name: 'daily limit',
      error: () => fail(503, 'AI_UNAVAILABLE', 'Daily AI limit reached', { reason: 'daily_limit' }),
      text: 'Daily AI limit reached – explanations are available again tomorrow.',
    },
    {
      name: 'unavailable',
      error: () => fail(503, 'AI_UNAVAILABLE', 'The AI service is not available'),
      text: 'The AI service is not available right now – try again later.',
    },
  ])('$name: a plain message and a way to contact the clinic', async (c) => {
    setup({ answer: () => c.error() });
    server.use(
      http.get(url('/settings/public'), () => ok({ ...PUBLIC_SETTINGS, phone: '+918041234567' })),
    );
    open();
    const user = userEvent.setup({ delay: null });
    await user.click(await explainButton());
    expect(await screen.findByText(c.text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contact the clinic/ })).toBeInTheDocument();
    // The prescription itself is still there.
    expect(screen.getByText('Paracetamol 650 mg')).toBeInTheDocument();
  });

  it('is replaced by a link to the consent setting when AI consent is withdrawn', async () => {
    setup({
      me: selfView({
        consent: {
          ...selfView().consent,
          aiExplanations: { given: false, at: '2026-10-05T05:00:00.000Z' },
        },
      }),
    });
    open();
    expect(
      await screen.findByRole('link', { name: 'Turn them on in My details' }, { timeout: 5000 }),
    ).toHaveAttribute('href', '/patient/profile#consent');
    expect(
      screen.queryByRole('button', { name: 'Explain in simple words' }),
    ).not.toBeInTheDocument();
  });

  it('is hidden when the clinic turned patient explanations off', async () => {
    setup();
    server.use(
      http.get(url('/settings/public'), () =>
        ok({ ...PUBLIC_SETTINGS, ai: { ...PUBLIC_SETTINGS.ai, patientExplanationEnabled: false } }),
      ),
    );
    open();
    expect(
      await screen.findByText('RX-2026-000003', { exact: false }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Explain in simple words' }),
    ).not.toBeInTheDocument();
  });

  it('is not offered for a cancelled prescription', async () => {
    setup({ rx: { ...issued, status: 'cancelled' } });
    open();
    expect(
      await screen.findByText('RX-2026-000003', { exact: false }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Explain in simple words' }),
    ).not.toBeInTheDocument();
  });
});

describe('Follow-up plan on the visit page', () => {
  const visit: PatientVisit = {
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
    followUp: { required: true, afterDays: 7, date: null, instructions: 'Bring the reports' },
    prescriptionId: null,
    labOrders: [],
    aiSummary: {
      text: 'You came in with a fever. Rest and take paracetamol as prescribed.',
      reviewedBy: 'Dr Anil Mehta',
      reviewedAt: '2026-09-20T05:00:00.000Z',
    },
  };

  it('shows the shared summary and explains the follow-up plan', async () => {
    let body: unknown;
    const followUp: Explanation = explanation({
      sourceType: 'follow_up_plan',
      sourceId: 'e1',
      content: {
        ...explanation().content,
        medicines: [],
        overview: 'Your doctor wants to see you again.',
        followUp: 'Come back in 7 days and bring your reports.',
      },
    });
    server.use(
      http.get(url('/encounters/e1'), () => ok(visit)),
      http.post(url('/encounters/e1/follow-up/explain'), async ({ request }) => {
        body = await request.json();
        return ok(followUp);
      }),
    );
    renderRoutes(routes, '/patient/visits/e1', authState(patient));
    const user = userEvent.setup({ delay: null });
    expect(
      await screen.findByRole(
        'heading',
        { name: 'AI-assisted summary, reviewed by your doctor' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/You came in with a fever/)).toBeInTheDocument();
    expect(screen.getByText(/^Reviewed by Dr Anil Mehta on /)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Explain in simple words' }));
    expect(
      await screen.findByText('Come back in 7 days and bring your reports.'),
    ).toBeInTheDocument();
    expect(body).toEqual({ language: 'en' });
    expect(screen.getByTestId('explanation-disclaimer')).toBeInTheDocument();
    // No feedback endpoint for follow-up plans.
    expect(screen.queryByText('Was this helpful?')).not.toBeInTheDocument();
  });

  it('has no AI summary card when nothing was shared', async () => {
    server.use(http.get(url('/encounters/e1'), () => ok({ ...visit, aiSummary: null })));
    renderRoutes(routes, '/patient/visits/e1', authState(patient));
    expect(
      await screen.findByRole('heading', { name: /Visit on/ }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('AI-assisted summary, reviewed by your doctor'),
    ).not.toBeInTheDocument();
  });
});
