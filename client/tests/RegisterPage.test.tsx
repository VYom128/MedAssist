import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../src/routes/routes';
import { http } from 'msw';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, PUBLIC_SETTINGS, server, url } from './msw/server';
import { selfView } from './patients.fixtures';

describe('RegisterPage', () => {
  const fillValid = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Priya');
    await user.type(screen.getByLabelText('Last name'), 'Sharma');
    await user.type(screen.getByLabelText('Email'), 'priya@example.com');
    await user.type(screen.getByLabelText('Mobile number'), '98765 43210'); // after "+91 "
    await user.type(screen.getByLabelText('Date of birth'), '1990-05-17');
    await user.type(screen.getByLabelText('Password'), 'Clinic2026!pass');
    await user.type(screen.getByLabelText('Confirm password'), 'Clinic2026!pass');
    return user;
  };

  const acceptAll = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('checkbox', { name: /terms of use/ }));
    await user.click(screen.getByRole('checkbox', { name: /processing my health information/ }));
  };
  const registered = (user: ReturnType<typeof makeUser>, status: string) =>
    ok(
      {
        accessToken: 'a',
        expiresIn: 900,
        user,
        link: { status, message: 'Message' },
      },
      { status: 201 },
    );

  it('requires accepting the terms and data-processing consent before calling the API', async () => {
    let called = false;
    server.use(
      http.post(url('/auth/register'), () => {
        called = true;
        return ok(null);
      }),
    );
    renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText('You must accept the terms to create an account'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Consent to data processing is required to create an account'),
    ).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('linked: sends DOB, E.164 phone and consent, then lands on the patient dashboard', async () => {
    const patient = makeUser('patient', {
      firstName: 'Priya',
      patientId: 'p1',
      patientLinkStatus: 'linked',
    });
    let body: unknown;
    server.use(
      http.post(url('/auth/register'), async ({ request }) => {
        body = await request.json();
        return registered(patient, 'linked');
      }),
      http.get(url('/patients/me'), () => ok(selfView())),
    );
    const { router } = renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Priya' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/patient/dashboard');
    expect(await screen.findByText('MRN-000001')).toBeInTheDocument();
    expect(body).toEqual({
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      phone: '+919876543210',
      dateOfBirth: '1990-05-17',
      password: 'Clinic2026!pass',
      acceptTerms: true,
      consent: { dataProcessing: true },
    });
  });

  it('pending_verification: shows the photo-ID screen, still logged in', async () => {
    const patient = makeUser('patient', {
      firstName: 'Priya',
      patientLinkStatus: 'pending_verification',
    });
    server.use(http.post(url('/auth/register'), () => registered(patient, 'pending_verification')));
    const { router, store } = renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('heading', { name: 'Almost there – show your photo ID' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/photo ID/, { selector: 'p' })).toHaveTextContent(
      'at the clinic reception to connect your records',
    );
    expect(router.state.location.pathname).toBe('/patient/verify-identity');
    expect(store.getState().auth.status).toBe('authenticated');
  });

  it('generic rejection: shows the message and the clinic phone number', async () => {
    server.use(
      http.get(url('/settings/public'), () => ok({ ...PUBLIC_SETTINGS, phone: '+918041234567' })),
      http.post(url('/auth/register'), () =>
        fail(
          422,
          'BUSINESS_RULE_VIOLATION',
          "We couldn't create your account. Please contact the clinic.",
        ),
      ),
    );
    renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByText(/We couldn't create your account/);
    expect(alert).toHaveTextContent('call MedAssist Clinic on +91 80 4123 4567');
  });

  it('shows server field errors on the matching input', async () => {
    server.use(
      http.post(url('/auth/register'), () =>
        fail(400, 'VALIDATION_ERROR', 'Validation failed', [
          { field: 'body.password', message: 'Must not contain your name or email' },
        ]),
      ),
    );
    renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await acceptAll(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Must not contain your name or email')).toBeInTheDocument();
  });

  it('shows live password hints, including the name/email rule', async () => {
    renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Priya');
    await user.type(screen.getByLabelText('Password'), 'priya2026');
    const list = screen.getByRole('list', { name: 'Password requirements' });
    expect(list).toHaveTextContent('At least 8 characters (met)');
    expect(list).toHaveTextContent('A letter and a number (met)');
    expect(list).toHaveTextContent('Does not contain your name or email (not met)');
  });
});
