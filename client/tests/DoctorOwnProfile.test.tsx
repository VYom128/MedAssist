import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { adminDoctor } from './doctors.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

const doctor = makeUser('doctor', { id: 'dr1' });

describe('Doctor: own profile', () => {
  it('edits only bio and languages; admin-only fields and controls are not shown', async () => {
    let patch: unknown;
    server.use(
      // The server sends the doctor their own admin-style view; the page must not show it all.
      http.get(url('/doctors/dr1'), () => ok(adminDoctor())),
      http.patch(url('/doctors/dr1'), async ({ request }) => {
        patch = await request.json();
        return ok(adminDoctor({ bio: 'Family medicine' }));
      }),
    );
    renderRoutes(routes, '/doctor/profile', authState(doctor));
    const bio = await screen.findByLabelText('Bio');
    expect(bio).toHaveValue('Adult medicine.');
    expect(screen.getByText('General Physician')).toBeInTheDocument();
    expect(screen.getByText('₹500.00')).toBeInTheDocument(); // read-only

    for (const hidden of ['KMC-12345', 'dr.mehta@medassist.dev', '+919812345670', '101']) {
      expect(screen.queryByText(hidden, { exact: false })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deactivate|Activate/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Consultation fee')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Registration number')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.clear(bio);
    await user.type(bio, 'Family medicine');
    await user.type(screen.getByLabelText('Languages'), 'Kannada{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patch).toEqual({ bio: 'Family medicine', languages: ['English', 'Hindi', 'Kannada'] }),
    );
  });

  it('doctors cannot open the admin doctor pages', async () => {
    const { router } = renderRoutes(routes, '/admin/doctors/dr1', authState(doctor));
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
  });

  it('the doctor sidebar has My schedule and My doctor profile', async () => {
    server.use(http.get(url('/doctors/dr1'), () => ok(adminDoctor())));
    renderRoutes(routes, '/doctor/profile', authState(doctor));
    await screen.findByLabelText('Bio');
    expect(screen.getAllByRole('link', { name: 'My schedule' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'My doctor profile' }).length).toBeGreaterThan(0);
  });
});
