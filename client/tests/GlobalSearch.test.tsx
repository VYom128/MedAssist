import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { SearchResults } from '../src/features/search/api';
import { routes } from '../src/routes/routes';
import { formatDateTime } from '../src/utils/dates';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

/** Global search in the top bar (spec §12.1, Phase 10). */

const reception = makeUser('receptionist');

const RESULTS: SearchResults = {
  groups: ['patients', 'appointments', 'invoices', 'labOrders'],
  patients: [
    { id: 'p1', mrn: 'MRN-2026-000001', name: 'Priya Sharma', link: '/reception/patients/p1' },
    { id: 'p2', mrn: 'MRN-2026-000002', name: 'Priyanka Rao', link: '/reception/patients/p2' },
  ],
  appointments: [
    {
      id: 'a1',
      number: 'APT-2026-000010',
      startAt: '2026-10-13T04:30:00.000Z',
      status: 'scheduled',
      patientName: 'Priya Sharma',
      doctorName: 'Asha Mehta',
      link: '/reception/appointments/a1',
    },
  ],
  invoices: [],
  labOrders: [],
};

/** Counts requests and remembers the terms. */
function searchHandler(results: SearchResults = RESULTS) {
  const terms: string[] = [];
  server.use(
    http.get(url('/search'), ({ request }) => {
      terms.push(new URL(request.url).searchParams.get('q') ?? '');
      return ok(results);
    }),
  );
  return terms;
}

const box = () => screen.findByRole('combobox', { name: 'Search records' });

describe('Global search', () => {
  it('waits 250 ms after typing and needs 2 characters', async () => {
    const terms = searchHandler();
    renderRoutes(routes, '/reception/dashboard', authState(reception));
    const user = userEvent.setup();
    const input = await box();
    await user.type(input, 'p');
    expect(await screen.findByText('Type at least 2 characters.')).toBeVisible();
    await user.type(input, 'ri');
    // Not yet: the request waits for typing to pause.
    expect(terms).toEqual([]);
    await waitFor(() => expect(terms).toEqual(['pri']));
    expect(await screen.findByRole('option', { name: /Priyanka Rao/ })).toBeVisible();
    // One request for the whole word, none for "p" or "pr".
    expect(terms).toEqual(['pri']);
  });

  it('groups the results and moves through them with ↑ ↓ and Enter', async () => {
    searchHandler();
    const { router } = renderRoutes(routes, '/reception/dashboard', authState(reception));
    const user = userEvent.setup();
    const input = await box();
    await user.type(input, 'pri');
    const list = await screen.findByRole('listbox', { name: 'Search results' });
    const patients = await within(list).findByRole('group', { name: 'Patients' });
    expect(within(patients).getAllByRole('option')).toHaveLength(2);
    const appointments = within(list).getByRole('group', { name: 'Appointments' });
    expect(within(appointments).getByRole('option')).toHaveTextContent(
      `Priya Sharma · Dr Asha Mehta · ${formatDateTime('2026-10-13T04:30:00.000Z')}`,
    );
    // Empty groups are not shown.
    expect(within(list).queryByRole('group', { name: 'Invoices' })).not.toBeInTheDocument();

    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id);
    await user.keyboard('{ArrowUp}');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/reception/patients/p2'));
    expect(input).toHaveValue('');
  });

  it('Esc closes the results; ⌘K and Ctrl+K focus the box', async () => {
    searchHandler();
    renderRoutes(routes, '/reception/dashboard', authState(reception));
    const user = userEvent.setup();
    const input = await box();
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(input).toHaveFocus();
    await user.type(input, 'pri');
    await screen.findByRole('listbox', { name: 'Search results' });
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    input.blur();
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    expect(input).toHaveFocus();
  });

  it('says so when nothing matches', async () => {
    searchHandler({ groups: ['patients', 'appointments'], patients: [], appointments: [] });
    renderRoutes(routes, '/reception/dashboard', authState(reception));
    const user = userEvent.setup();
    await user.type(await box(), 'zz');
    expect(await screen.findByText('No results for “zz”.')).toBeVisible();
  });

  it('is not shown while a password change is forced', async () => {
    renderRoutes(
      routes,
      '/change-password',
      authState(makeUser('receptionist', { mustChangePassword: true })),
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('combobox', { name: 'Search records' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Notifications/ })).not.toBeInTheDocument();
  });
});
