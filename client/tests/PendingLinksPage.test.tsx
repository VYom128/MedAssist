import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';
import { paged, pendingLink, receptionView } from './patients.fixtures';

const reception = makeUser('receptionist');

describe('PendingLinksPage', () => {
  it('confirms identity after the photo-ID reminder, then the list empties', async () => {
    let items = [pendingLink()];
    let body: unknown;
    server.use(
      http.get(url('/patients/pending-links'), () => ok(items, paged(items))),
      http.post(url('/patients/p1/confirm-link'), async ({ request }) => {
        body = await request.json();
        items = [];
        return ok(receptionView());
      }),
    );
    renderRoutes(routes, '/reception/pending-links', authState(reception));
    const list = await screen.findByRole('list', { name: 'Pending verifications' });
    expect(list).toHaveTextContent('priya.new@example.com');
    expect(list).toHaveTextContent('MRN-000001');
    // Sidebar badge shows the count.
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(within(list).getByRole('button', { name: 'Confirm identity' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm identity?' });
    expect(dialog).toHaveTextContent('photo ID');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and link' }));

    await waitFor(() => expect(body).toEqual({ userId: 'u9' }));
    expect(await screen.findByText('Nothing to verify')).toBeInTheDocument();
  });

  it('"Not this person" needs a reason and creates a separate record', async () => {
    let body: unknown;
    server.use(
      http.get(url('/patients/pending-links'), () => ok([pendingLink()], paged([1]))),
      http.post(url('/patients/p1/reject-link'), async ({ request }) => {
        body = await request.json();
        return ok(receptionView({ id: 'p9', mrn: 'MRN-000009' }));
      }),
    );
    renderRoutes(routes, '/reception/pending-links', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Not this person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Not this person?' });
    await user.click(within(dialog).getByRole('button', { name: 'Create separate record' }));
    expect(body).toBeUndefined();
    await user.type(within(dialog).getByLabelText('Reason'), 'Different person, twin sister');
    await user.click(within(dialog).getByRole('button', { name: 'Create separate record' }));
    await waitFor(() =>
      expect(body).toEqual({ userId: 'u9', reason: 'Different person, twin sister' }),
    );
  });
});
