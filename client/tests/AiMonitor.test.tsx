import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { aiConfig, interaction, interactionSummary } from './ai.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

/** The admin AI monitor (Phase 9): numbers and models – never content or the API key. */

const admin = makeUser('admin');
const SECRET = /SECRET/;

function setup() {
  const listParams: URLSearchParams[] = [];
  const summaryParams: URLSearchParams[] = [];
  // Content-like fields the server never sends: the page must not show them even if it did.
  const leak = {
    prompt: 'SECRET system prompt',
    input: { patientName: 'SECRET Priya' },
    output: 'SECRET model answer',
    content: { overview: 'SECRET overview' },
  };
  server.use(
    http.get(url('/ai/config'), () => ok({ ...aiConfig(), apiKey: 'sk-SECRET-key', ...leak })),
    http.get(url('/ai/interactions/summary'), ({ request }) => {
      summaryParams.push(new URL(request.url).searchParams);
      return ok({ ...interactionSummary(), ...leak });
    }),
    http.get(url('/ai/interactions'), ({ request }) => {
      listParams.push(new URL(request.url).searchParams);
      const rows = [
        { ...interaction(), ...leak },
        {
          ...interaction({
            id: 'i2',
            feature: 'clinical_summary',
            status: 'success',
            model: 'llama-3.3-70b-versatile',
            isFallbackModel: true,
            guardrailFlags: [],
            promptVersion: 'clinical_summary.v1',
          }),
          ...leak,
        },
      ];
      return ok(rows, { meta: { page: 1, limit: 20, total: 2, totalPages: 1 } });
    }),
  );
  return { listParams, summaryParams };
}

describe('AI monitor', () => {
  it('shows the stats, today vs the limit and the models – never content or the key', async () => {
    setup();
    renderRoutes(routes, '/admin/ai-monitor', authState(admin));
    expect(
      await screen.findByRole('heading', { name: 'AI monitor' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('12.5 %')).toBeInTheDocument(); // failure rate
    for (const label of [
      'AI calls',
      'Failure rate',
      'Fallback-model rate',
      'Template-fallback rate',
      'Guardrail blocks',
      'Tokens',
      'Latency',
      'Helpful',
    ]) {
      // Stat labels (some are also table headers).
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('5.0 %')).toBeInTheDocument();
    expect(screen.getByText('20.0 %')).toBeInTheDocument();
    expect(screen.getByText('51,000')).toBeInTheDocument();
    expect(screen.getByText('80 %')).toBeInTheDocument();
    expect(screen.getByText(/p95 5\.4 s/)).toBeInTheDocument();

    expect(await screen.findByText('41 of 300 (daily limit)')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '41');
    expect(screen.getByText('api.groq.com')).toBeInTheDocument();
    const models = screen.getByRole('table', { name: 'AI attempts per model' });
    expect(within(models).getByText('llama-3.3-70b-versatile')).toBeInTheDocument();

    const recent = await screen.findByRole('table', { name: 'Recent AI attempts' });
    expect(within(recent).getByText('Patient explanation')).toBeInTheDocument();
    expect(within(recent).getByText('Forbidden phrase')).toBeInTheDocument();
    expect(within(recent).getByText('Fallback')).toBeInTheDocument();
    expect(within(recent).getByText('patient_explanation.v1')).toBeInTheDocument();
    expect(within(recent).getByText('Blocked')).toBeInTheDocument();

    await waitFor(() => expect(document.body.textContent).not.toMatch(SECRET));
    expect(document.body.textContent).not.toMatch(/sk-/);
  });

  it('filters by date range, feature and status', async () => {
    const { listParams, summaryParams } = setup();
    renderRoutes(routes, '/admin/ai-monitor', authState(admin));
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Recent AI attempts' }, { timeout: 5000 });
    await user.selectOptions(screen.getByLabelText('Status'), 'blocked');
    await waitFor(() => expect(listParams.at(-1)?.get('status')).toBe('blocked'));

    const from = screen.getByLabelText('From');
    await user.clear(from);
    await user.type(from, '2026-10-01');
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2026-10-05');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(summaryParams.at(-1)?.get('from')).toBe('2026-10-01'));
    expect(summaryParams.at(-1)?.get('to')).toBe('2026-10-05');
    expect(listParams.at(-1)?.get('to')).toBe('2026-10-05');
  });

  it('is in the admin sidebar', async () => {
    setup();
    renderRoutes(routes, '/admin/ai-monitor', authState(admin));
    expect(
      (await screen.findAllByRole('link', { name: 'AI monitor' }, { timeout: 5000 }))[0],
    ).toHaveAttribute('href', '/admin/ai-monitor');
  });
});
