import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';
import { receptionView } from './patients.fixtures';
import { timelineItem, timelineMeta } from './timeline.fixtures';

/** The patient timeline component (Phase 8, spec §8.8): cursor pages, filters, per-role data. */

const patient = makeUser('patient', { patientId: 'p1', patientLinkStatus: 'linked' });
const reception = makeUser('receptionist', { id: 'r1' });

/** Three pages of mixed items at the same time, linked by cursors c1 → c2 → end. */
const PAGES: Record<string, ReturnType<typeof timelineItem>[]> = {
  first: [
    timelineItem({ id: 'a1', title: 'Visit with Dr Anil Mehta' }),
    timelineItem({ type: 'invoice', id: 'i1', title: 'Invoice INV-2026-000001', status: 'paid' }),
  ],
  c1: [
    // The server never repeats an item, but the client must not show one twice if it did.
    timelineItem({ type: 'invoice', id: 'i1', title: 'Invoice INV-2026-000001', status: 'paid' }),
    timelineItem({
      type: 'payment',
      id: 'pay1',
      title: 'Payment PAY-2026-000001',
      status: 'payment',
    }),
  ],
  c2: [
    timelineItem({
      type: 'document',
      id: 'd1',
      title: 'Aadhaar card',
      status: null,
      at: '2026-08-02T05:00:00.000Z',
    }),
  ],
};
const NEXT: Record<string, string | null> = { first: 'c1', c1: 'c2', c2: null };

describe('Timeline', () => {
  it('"Load more" appends the next cursor page without duplicates, grouped by month', async () => {
    const befores: (string | null)[] = [];
    server.use(
      http.get(url('/patients/me/timeline'), ({ request }) => {
        const before = new URL(request.url).searchParams.get('before');
        befores.push(before);
        const key = before ?? 'first';
        return ok(PAGES[key], { meta: timelineMeta(NEXT[key]) });
      }),
    );
    renderRoutes(routes, '/patient/timeline', authState(patient));
    const user = userEvent.setup();
    const feed = await screen.findByRole('feed', { name: 'My timeline' }, { timeout: 5000 });
    expect(within(feed).getAllByRole('listitem')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(feed).getAllByRole('listitem')).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(feed).getAllByRole('listitem')).toHaveLength(4));

    expect(befores).toEqual([null, 'c1', 'c2']);
    expect(screen.getAllByText('Invoice INV-2026-000001')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    // Month groups (clinic time).
    expect(screen.getByRole('region', { name: 'September 2026' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'August 2026' })).toBeInTheDocument();
    // Status pills and links come straight from the item.
    expect(screen.getByRole('link', { name: 'Visit with Dr Anil Mehta' })).toHaveAttribute(
      'href',
      '/doctor/appointments/a1',
    );
  });

  it('type filters and dates refetch from the first page', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(url('/patients/me/timeline'), ({ request }) => {
        const params = new URL(request.url).searchParams;
        queries.push(params);
        const types = params.get('types');
        const items = types === 'invoice' ? [PAGES.first![1]!] : PAGES.first!;
        return ok(items, { meta: timelineMeta(null) });
      }),
    );
    renderRoutes(routes, '/patient/timeline', authState(patient));
    const user = userEvent.setup();
    await screen.findByRole('feed', {}, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Invoices' }));
    await waitFor(() => expect(queries.at(-1)?.get('types')).toBe('invoice'));
    await waitFor(() =>
      expect(screen.queryByText('Visit with Dr Anil Mehta')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Invoices' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(queries.at(-1)?.get('before')).toBeNull();

    await user.type(screen.getByLabelText('From'), '2026-09-01');
    await waitFor(() => expect(queries.at(-1)?.get('from')).toBe('2026-09-01'));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(queries.at(-1)?.get('types')).toBeNull());
  });

  it('empty and error states', async () => {
    server.use(http.get(url('/patients/me/timeline'), () => ok([], { meta: timelineMeta(null) })));
    renderRoutes(routes, '/patient/timeline', authState(patient));
    expect(await screen.findByText('Nothing here yet', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('Reception timeline tab', () => {
  it('renders only what the API returns (non-clinical items), with reception filters', async () => {
    server.use(
      http.get(url('/patients/p1'), () => ok(receptionView())),
      http.get(url('/patients/p1/timeline'), () =>
        ok(
          [
            timelineItem({ link: '/reception/appointments/a1' }),
            timelineItem({
              type: 'invoice',
              id: 'i1',
              title: 'Invoice INV-2026-000001',
              subtitle: '₹850.00 paid',
              status: 'paid',
              link: '/reception/invoices/i1',
            }),
          ],
          { meta: timelineMeta(null) },
        ),
      ),
    );
    renderRoutes(routes, '/reception/patients/p1?tab=timeline', authState(reception));
    const feed = await screen.findByRole('feed', {}, { timeout: 5000 });
    expect(within(feed).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('₹850.00 paid')).toBeInTheDocument();
    // Reception's filter chips have no clinical types.
    const chips = within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(chips).toEqual([
      'All',
      'Appointments',
      'Invoices',
      'Payments',
      'Documents',
      'Follow-up requests',
    ]);
    expect(within(feed).queryByText(/Clinical note|Prescription|Lab/)).not.toBeInTheDocument();
  });
});
