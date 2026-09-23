import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../src/routes/routes';
import { http } from 'msw';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

describe('RegisterPage', () => {
  const fillValid = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Priya');
    await user.type(screen.getByLabelText('Last name'), 'Sharma');
    await user.type(screen.getByLabelText('Email'), 'priya@example.com');
    await user.type(screen.getByLabelText('Mobile number'), '+91 98765 43210');
    await user.type(screen.getByLabelText('Date of birth'), '1990-05-17');
    await user.type(screen.getByLabelText('Password'), 'Clinic2026!pass');
    await user.type(screen.getByLabelText('Confirm password'), 'Clinic2026!pass');
    return user;
  };

  it('requires accepting the terms before calling the API', async () => {
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
    expect(called).toBe(false);
  });

  it('sends date of birth and acceptTerms, then lands on the patient dashboard', async () => {
    const patient = makeUser('patient', { firstName: 'Priya' });
    let body: unknown;
    server.use(
      http.post(url('/auth/register'), async ({ request }) => {
        body = await request.json();
        return ok({ accessToken: 'a', expiresIn: 900, user: patient }, { status: 201 });
      }),
    );
    const { router } = renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Priya' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/patient/dashboard');
    expect(body).toEqual({
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      phone: '+91 98765 43210',
      dateOfBirth: '1990-05-17',
      password: 'Clinic2026!pass',
      acceptTerms: true,
    });
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
    await user.click(screen.getByRole('checkbox'));
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
