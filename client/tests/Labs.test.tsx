import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { attachInvalidation } from '../src/app/socketInvalidation';
import type { LabOrder } from '../src/features/labs/api';
import { computeFlag, selectRange } from '../src/features/labs/ranges';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { collectedSample, labItem, labOrder, labTest, worklistItem } from './labs.fixtures';
import { fail, ok, server, url } from './msw/server';

/** Lab worklist and order processing (spec §4.8, §13.4 #6). */

const labtech = makeUser('labtech', { id: 'lab1', firstName: 'Lakshmi', lastName: 'Nair' });
const meta = (total: number) => ({ page: 1, limit: 20, total, totalPages: total ? 1 : 0 });

/** Serves order lo1 (mutable) and test t1; returns the POST/PUT bodies received. */
function serveOrder(initial: LabOrder) {
  let current = initial;
  const calls: { path: string; body: unknown }[] = [];
  const respond = async (request: Request, next: (body: Record<string, unknown>) => LabOrder) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    calls.push({ path: new URL(request.url).pathname.replace('/api/v1', ''), body });
    current = next(body);
    return ok(current);
  };
  server.use(
    http.get(url('/lab-orders/lo1'), () => ok(current)),
    http.get(url('/lab-tests/t1'), () => ok(labTest())),
    http.post(url('/lab-orders/lo1/collect-sample'), ({ request }) =>
      respond(request, () => ({ ...current, status: 'sample_collected', sample: collectedSample })),
    ),
    http.post(url('/lab-orders/lo1/verify'), ({ request }) =>
      respond(request, () => ({ ...current, status: 'verified' })),
    ),
    http.post(url('/lab-orders/lo1/release'), ({ request }) =>
      respond(request, () => ({ ...current, status: 'released', reportAvailable: true })),
    ),
    http.post(url('/lab-orders/lo1/reject-sample'), ({ request }) =>
      respond(request, (b) => ({
        ...current,
        status: 'sample_rejected',
        sample: {
          ...collectedSample,
          rejection: { reason: String(b.reason), at: '2026-09-25T06:00:00Z' },
        },
      })),
    ),
    http.put(url('/lab-orders/lo1/items/i1/results'), ({ request }) =>
      respond(request, () => ({
        ...current,
        status: 'result_entered',
        hasCritical: true,
        items: [
          labItem({
            status: 'result_entered',
            enteredBy: { id: 'lab1', name: 'Lakshmi Nair' },
            results: [
              {
                parameterKey: 'hb',
                name: 'Haemoglobin',
                unit: 'g/dL',
                value: 6.5,
                referenceText: '12–15.5 g/dL',
                flag: 'critical_low',
              },
            ],
          }),
        ],
      })),
    ),
    http.post(url('/lab-orders/lo1/items/i1/verify-revision'), ({ request }) =>
      respond(request, () => ({
        ...current,
        items: [labItem({ status: 'verified', resultVersion: 2, pendingRevision: null })],
      })),
    ),
    http.post(url('/lab-orders/lo1/items/i1/cancel'), ({ request }) =>
      respond(request, () => ({
        ...current,
        status: 'cancelled',
        items: [labItem({ status: 'cancelled' })],
      })),
    ),
  );
  return calls;
}

const openOrder = () => renderRoutes(routes, '/lab/orders/lo1', authState(labtech));

describe('lab worklist', () => {
  function serveWorklist() {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(url('/lab-orders'), ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        const status = params.get('status');
        const items =
          status === 'ordered'
            ? [
                worklistItem({ id: 'lo2', orderNumber: 'LAB-2026-000013', priority: 'urgent' }),
                worklistItem({ tatBreachedAt: '2026-09-25T10:00:00Z' }),
              ]
            : status === 'processing'
              ? [worklistItem({ id: 'lo3', status: 'processing', orderNumber: 'LAB-2026-000014' })]
              : [];
        const limit = Number(params.get('limit'));
        return ok(limit === 1 ? items.slice(0, 1) : items, { meta: meta(items.length) });
      }),
    );
    return requests;
  }

  it('shows tabs with counts, urgent and overdue orders, and the patient', async () => {
    serveWorklist();
    renderRoutes(routes, '/lab/worklist', authState(labtech));
    expect(
      await screen.findByRole('tab', { name: 'To collect (2)' }, { timeout: 5000 }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('tab', { name: 'Processing (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Awaiting verification (0)' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Lab orders' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('LAB-2026-000013');
    expect(within(rows[1]!).getByText('Urgent')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Overdue')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Priya Sharma');
    expect(rows[1]).toHaveTextContent('MRN-000001');
    expect(within(rows[1]!).getByRole('link', { name: 'LAB-2026-000013' })).toHaveAttribute(
      'href',
      '/lab/orders/lo2',
    );
  });

  it('switching tabs and searching filter the list; "Released today" asks for today', async () => {
    const requests = serveWorklist();
    renderRoutes(routes, '/lab/worklist', authState(labtech));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /Processing/ }, { timeout: 5000 }));
    expect((await screen.findAllByText('LAB-2026-000014')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: /Released today/ }));
    expect(await screen.findByText('Nothing here right now')).toBeInTheDocument();
    expect(requests.some((p) => p.get('status') === 'released' && p.get('releasedOn'))).toBe(true);
    await user.type(screen.getByLabelText('Search'), 'MRN-000001');
    await waitFor(() =>
      expect(requests.some((p) => p.get('q') === 'MRN-000001' && p.get('limit') === '20')).toBe(
        true,
      ),
    );
  });

  it('refreshes live when the server says the worklist changed', async () => {
    const requests = serveWorklist();
    const { store } = renderRoutes(routes, '/lab/worklist', authState(labtech));
    await screen.findByRole('table', { name: 'Lab orders' }, { timeout: 5000 });
    const before = requests.length;
    const handlers = new Map<string, (p: unknown) => void>();
    attachInvalidation(
      {
        on: (e: string, h: (p: unknown) => void) => handlers.set(e, h),
        off: () => undefined,
      } as never,
      store.dispatch,
    );
    act(() => handlers.get('lab.worklist.updated')!({ orderIds: ['lo9'] }));
    await waitFor(() => expect(requests.length).toBeGreaterThan(before));
  });

  it('error and retry', async () => {
    server.use(http.get(url('/lab-orders'), () => fail(500, 'INTERNAL_ERROR', 'Server down')));
    renderRoutes(routes, '/lab/worklist', authState(labtech));
    expect(await screen.findByText('Server down', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('lab order page', () => {
  it('shows the order header: patient, allergies, doctor, clinical notes, preparation', async () => {
    serveOrder(labOrder());
    openOrder();
    expect(
      await screen.findByRole('heading', { name: 'LAB-2026-000012' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByText('38 years · Female')).toBeInTheDocument();
    expect(screen.getByText('Latex (moderate)')).toBeInTheDocument();
    expect(screen.getByText('Dr Anil Mehta')).toBeInTheDocument();
    expect(screen.getByText('Fatigue for a month – anaemia?')).toBeInTheDocument();
    expect(await screen.findByText('Preparation: No fasting needed')).toBeInTheDocument();
  });

  it('collect sample → the label page with the sample ID', async () => {
    const calls = serveOrder(labOrder());
    const { router } = openOrder();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Collect sample' }, { timeout: 5000 }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/print/lab-labels/lo1'));
    expect(calls.map((c) => c.path)).toEqual(['/lab-orders/lo1/collect-sample']);
    const label = await screen.findByLabelText('Sample label', {}, { timeout: 5000 });
    expect(label).toHaveTextContent('S26-000042');
    expect(label).toHaveTextContent('Priya Sharma');
    expect(label).toHaveTextContent('MRN-000001');
    expect(label).toHaveTextContent('CBC');
  });

  it('reject sample needs a reason', async () => {
    const calls = serveOrder(labOrder({ status: 'sample_collected', sample: collectedSample }));
    openOrder();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Reject sample' }, { timeout: 5000 }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Haemolysed');
    await user.click(within(dialog).getByRole('button', { name: 'Reject sample' }));
    await waitFor(() =>
      expect(calls).toEqual([
        { path: '/lab-orders/lo1/reject-sample', body: { reason: 'Haemolysed' } },
      ]),
    );
    expect(await screen.findByText(/Haemolysed/)).toBeInTheDocument();
  });

  it('results entry: reference for this patient, live flag, values sent without flags', async () => {
    const calls = serveOrder(labOrder({ status: 'processing', sample: collectedSample }));
    openOrder();
    const user = userEvent.setup();
    const hb = await screen.findByLabelText(/Haemoglobin/, {}, { timeout: 5000 });
    // Female, 38 years → the female adult range.
    expect(screen.getByText('Ref. 12–15.5 g/dL')).toBeInTheDocument();
    expect(screen.getByText('0 of 1 tests entered.')).toBeInTheDocument();
    await user.type(hb, '6.5');
    expect(screen.getByText('Critical low')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Malaria smear/), 'Positive');
    expect(screen.getByText('Abnormal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save CBC' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      path: '/lab-orders/lo1/items/i1/results',
      body: {
        results: [
          { parameterKey: 'hb', value: 6.5 },
          { parameterKey: 'smear', value: 'Positive' },
        ],
        remarks: null,
      },
    });
    // After saving the server's result is shown (read-only, awaiting verification).
    expect(await screen.findByText('Critical value')).toBeInTheDocument();
  });

  it('a non-number stays on the page with an error', async () => {
    const calls = serveOrder(labOrder({ status: 'processing', sample: collectedSample }));
    openOrder();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Haemoglobin/, {}, { timeout: 5000 }), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save CBC' }));
    expect(await screen.findByText('Enter a number')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('verify is disabled (with the reason) for the technician who entered the results', async () => {
    serveOrder(
      labOrder({
        status: 'result_entered',
        sample: collectedSample,
        items: [
          labItem({ status: 'result_entered', enteredBy: { id: 'lab1', name: 'Lakshmi Nair' } }),
        ],
      }),
    );
    openOrder();
    expect(await screen.findByRole('button', { name: 'Verify' }, { timeout: 5000 })).toBeDisabled();
    expect(screen.getByText('Another lab technician must verify')).toBeInTheDocument();
  });

  it('another technician verifies; release asks for confirmation first', async () => {
    const calls = serveOrder(
      labOrder({
        status: 'result_entered',
        sample: collectedSample,
        items: [
          labItem({ status: 'result_entered', enteredBy: { id: 'lab2', name: 'Arjun Reddy' } }),
        ],
      }),
    );
    openOrder();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Verify' }, { timeout: 5000 }));
    await user.click(await screen.findByRole('button', { name: 'Release' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The patient and doctor will be able to see these results');
    await user.click(within(dialog).getByRole('button', { name: 'Release' }));
    await waitFor(() =>
      expect(calls.map((c) => c.path)).toEqual([
        '/lab-orders/lo1/verify',
        '/lab-orders/lo1/release',
      ]),
    );
    expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });

  it('released: a pending correction shows before/after; another tech verifies it', async () => {
    const released = labItem({
      status: 'verified',
      results: [
        {
          parameterKey: 'hb',
          name: 'Haemoglobin',
          unit: 'g/dL',
          value: 14.2,
          referenceText: null,
          flag: 'normal',
        },
      ],
      pendingRevision: {
        results: [
          {
            parameterKey: 'hb',
            name: 'Haemoglobin',
            unit: 'g/dL',
            value: 12.4,
            referenceText: null,
            flag: 'normal',
          },
        ],
        remarks: null,
        reason: 'Transcription error',
        by: 'lab2',
        at: '2026-09-25T08:00:00Z',
      },
    });
    const calls = serveOrder(
      labOrder({ status: 'released', sample: collectedSample, items: [released] }),
    );
    openOrder();
    const user = userEvent.setup();
    const alert = await screen.findByText(
      'Correction waiting for verification',
      {},
      { timeout: 5000 },
    );
    const box = alert.closest('[role="alert"], div')!.parentElement!;
    expect(within(box).getByText('14.2')).toBeInTheDocument();
    expect(within(box).getByText('12.4')).toBeInTheDocument();
    expect(screen.getByText(/Transcription error/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verify revision' }));
    await waitFor(() =>
      expect(calls.map((c) => c.path)).toEqual(['/lab-orders/lo1/items/i1/verify-revision']),
    );
  });

  it('cancel a test with a reason', async () => {
    const calls = serveOrder(labOrder());
    openOrder();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel test' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Reagent unavailable');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel test' }));
    await waitFor(() =>
      expect(calls).toEqual([
        { path: '/lab-orders/lo1/items/i1/cancel', body: { reason: 'Reagent unavailable' } },
      ]),
    );
  });

  it('a missing order shows the error state', async () => {
    server.use(
      http.get(url('/lab-orders/lo1'), () => fail(404, 'NOT_FOUND', 'Lab order not found')),
    );
    openOrder();
    expect(
      await screen.findByText('Lab order not found', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe('client flag preview mirrors the server rules', () => {
  const p = labTest().parameters[0]!;
  it('uses the sex-specific range and the §8.7 bounds', () => {
    const female = selectRange(p, { gender: 'female', ageYears: 40 });
    expect(computeFlag(6.9, p, female)).toBe('critical_low');
    expect(computeFlag(12, p, female)).toBe('normal');
    expect(computeFlag(15.6, p, female)).toBe('high');
    expect(computeFlag(12.5, p, selectRange(p, { gender: 'male', ageYears: 40 }))).toBe('low');
    expect(selectRange(p, { gender: 'male', ageYears: 10 })).toBeNull();
  });
});
