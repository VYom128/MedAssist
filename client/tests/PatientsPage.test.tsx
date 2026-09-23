import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';
import { adminView, listItem, paged, receptionView } from './patients.fixtures';

const reception = makeUser('receptionist');
const admin = makeUser('admin');

describe('PatientsPage', () => {
  let queries: URLSearchParams[];
  beforeEach(() => {
    queries = [];
    server.use(
      http.get(url('/patients'), ({ request }) => {
        const q = new URL(request.url).searchParams;
        queries.push(q);
        const items = q.get('q')
          ? [listItem()]
          : [listItem(), listItem({ id: 'p2', fullName: 'Rahul Verma', mrn: 'MRN-000002' })];
        return ok(items, paged(items));
      }),
    );
  });

  it('lists patients with MRN, name, age/sex, phone and portal status', async () => {
    renderRoutes(routes, '/reception/patients', authState(reception));
    const table = await screen.findByRole('table', { name: 'Patients' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('MRN-000001');
    expect(rows[0]).toHaveTextContent('Priya Sharma');
    expect(rows[0]).toHaveTextContent('36 y · F');
    expect(rows[0]).toHaveTextContent('+91 98765 43210');
    expect(rows[0]).toHaveTextContent('No portal');
    expect(screen.getAllByRole('link', { name: 'New patient' }).length).toBeGreaterThan(0);
  });

  it('debounces the search box and keeps the query in the URL', async () => {
    const { router } = renderRoutes(routes, '/reception/patients', authState(reception));
    await screen.findByRole('table', { name: 'Patients' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search'), 'pri');

    // Not yet: the request waits for typing to pause.
    expect(router.state.location.search).toBe('');
    await waitFor(() => expect(router.state.location.search).toBe('?q=pri'));
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('pri'));
    // One search request for the three keystrokes.
    expect(queries.filter((q) => q.get('q')).map((q) => q.get('q'))).toEqual(['pri']);
  });

  it('keeps filters in the URL and sends them to the API', async () => {
    const { router } = renderRoutes(routes, '/reception/patients', authState(reception));
    await screen.findByRole('table', { name: 'Patients' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Age'), '60-120');
    await user.selectOptions(screen.getByLabelText('Portal'), 'yes');
    await waitFor(() => expect(router.state.location.search).toBe('?age=60-120&portal=yes'));
    await waitFor(() =>
      expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({
        ageMin: '60',
        ageMax: '120',
        hasPortal: 'true',
      }),
    );
  });

  it('suggests registering a patient when nothing matches', async () => {
    server.use(http.get(url('/patients'), () => ok([], paged([]))));
    renderRoutes(routes, '/reception/patients?q=nobody', authState(reception));
    expect(await screen.findByText('No patients match')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New patient' }).length).toBeGreaterThan(0);
  });

  it('admins get a read-only list with a "show inactive" filter', async () => {
    const { router } = renderRoutes(routes, '/admin/patients', authState(admin));
    await screen.findByRole('table', { name: 'Patients' });
    expect(screen.queryByRole('link', { name: 'New patient' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Show inactive only' }));
    await waitFor(() => expect(router.state.location.search).toBe('?inactive=1'));
    await waitFor(() => expect(queries.at(-1)?.get('isActive')).toBe('false'));
  });
});

describe('PatientDetailPage – field visibility (spec §2.5)', () => {
  it('a receptionist sees allergies in red chips and can edit', async () => {
    server.use(http.get(url('/patients/p1'), () => ok(receptionView())));
    renderRoutes(routes, '/reception/patients/p1', authState(reception));
    expect(await screen.findByRole('heading', { name: 'Priya Sharma' })).toBeInTheDocument();
    const chips = screen.getAllByRole('list', { name: 'Allergies' })[0]!;
    expect(chips).toHaveTextContent('Penicillin (severe)');
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('an admin sees no allergies, cannot edit, and can deactivate with a reason', async () => {
    let body: unknown;
    server.use(
      http.get(url('/patients/p1'), () => ok(adminView())),
      http.post(url('/patients/p1/deactivate'), async ({ request }) => {
        body = await request.json();
        return ok(adminView({ isActive: false }));
      }),
    );
    renderRoutes(routes, '/admin/patients/p1', authState(admin));
    expect(await screen.findByRole('heading', { name: 'Priya Sharma' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Allergies' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Penicillin/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate patient?' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Duplicate record');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(body).toEqual({ reason: 'Duplicate record' }));
  });

  it('the portal tab invites a patient who has an email', async () => {
    let invited = false;
    server.use(
      http.get(url('/patients/p1'), () => ok(receptionView())),
      http.post(url('/patients/p1/portal-invite'), () => {
        invited = true;
        return ok(
          receptionView({
            hasPortal: true,
            portal: {
              hasAccount: true,
              email: 'priya@example.com',
              linkStatus: 'linked',
              lastLoginAt: null,
            },
          }),
          { status: 201 },
        );
      }),
    );
    renderRoutes(routes, '/reception/patients/p1?tab=portal', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Invite to patient portal' }));
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(invited).toBe(true));
  });
});
