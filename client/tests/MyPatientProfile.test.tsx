import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';
import { selfView } from './patients.fixtures';

const linked = makeUser('patient', {
  firstName: 'Priya',
  patientId: 'p1',
  patientLinkStatus: 'linked',
});

describe('/patient/profile', () => {
  it('shows name and DOB read-only, and saves only the editable contact details', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(url('/patients/me'), () => ok(selfView())),
      http.patch(url('/patients/me'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok(selfView({ address: { line1: '5 Lake Road', city: 'Pune' } }));
      }),
    );
    renderRoutes(routes, '/patient/profile', authState(linked));
    const record = await screen.findByRole('region', { name: 'My record' });
    expect(record).toHaveTextContent('MRN-000001');
    expect(record).toHaveTextContent('17 May 1990');
    expect(record).toHaveTextContent('Contact reception to change');
    // No inputs for identity fields.
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
    expect(within(record).queryByRole('textbox')).not.toBeInTheDocument();

    // Allergies and conditions are read-only.
    const health = screen.getByRole('region', { name: 'Allergies and conditions' });
    expect(health).toHaveTextContent('Recorded by your clinic');
    expect(health).toHaveTextContent('Penicillin');
    expect(health).toHaveTextContent('Asthma');
    expect(within(health).queryByRole('button')).not.toBeInTheDocument();

    const user = userEvent.setup();
    const city = screen.getByLabelText('City');
    await user.clear(city);
    await user.type(city, 'Pune');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(Object.keys(body!).sort()).toEqual(
      ['address', 'email', 'emergencyContact', 'phone', 'preferredLanguage'].sort(),
    );
    expect(body).toMatchObject({ phone: '+919876543210', address: { city: 'Pune' } });
  });

  it('turning off AI explanations explains what it means before saving', async () => {
    let body: unknown;
    server.use(
      http.get(url('/patients/me'), () => ok(selfView())),
      http.patch(url('/patients/me'), async ({ request }) => {
        body = await request.json();
        return ok(selfView());
      }),
    );
    renderRoutes(routes, '/patient/profile', authState(linked));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'AI explanations' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn off AI explanations?' });
    expect(dialog).toHaveTextContent('no longer be offered plain-language AI explanations');
    expect(body).toBeUndefined();
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(body).toEqual({ consent: { aiExplanations: false } }));
  });

  it('a pending account sees why no records are shown', async () => {
    server.use(
      http.get(url('/patients/me'), () =>
        fail(403, 'PATIENT_LINK_PENDING', 'Your account is waiting for the clinic.'),
      ),
    );
    renderRoutes(
      routes,
      '/patient/profile',
      authState(makeUser('patient', { patientLinkStatus: 'pending_verification' })),
    );
    expect(
      await screen.findByText('Waiting for the clinic to confirm your identity'),
    ).toBeInTheDocument();
  });
});

describe('PatientDashboard', () => {
  it('pending: a banner and no record cards', async () => {
    renderRoutes(
      routes,
      '/patient/dashboard',
      authState(
        makeUser('patient', { firstName: 'Priya', patientLinkStatus: 'pending_verification' }),
      ),
    );
    expect(
      await screen.findByText('Please verify your identity at the clinic'),
    ).toBeInTheDocument();
    expect(screen.queryByText('My details', { selector: 'h2' })).not.toBeInTheDocument();
    expect(screen.queryByText('Coming in later phases')).not.toBeInTheDocument();
  });

  it('linked: "My details" with the MRN and a link to the profile', async () => {
    server.use(http.get(url('/patients/me'), () => ok(selfView())));
    renderRoutes(routes, '/patient/dashboard', authState(linked));
    expect(await screen.findByText('MRN-000001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      '/patient/profile',
    );
  });
});
