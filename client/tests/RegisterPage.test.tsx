import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../src/routes/routes';
import { authState, fail, makeUser, mockHttp, ok, renderRoutes } from './helpers';

describe('RegisterPage', () => {
  let mock: ReturnType<typeof mockHttp> | undefined;
  afterEach(() => mock?.restore());

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
    mock = mockHttp(() => ok(null));
    renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText('You must accept the terms to create an account'),
    ).toBeInTheDocument();
    expect(mock.calls).toHaveLength(0);
  });

  it('sends date of birth and acceptTerms, then lands on the patient dashboard', async () => {
    const patient = makeUser('patient', { firstName: 'Priya' });
    mock = mockHttp(() => ({
      status: 201,
      body: {
        success: true,
        message: 'Account created',
        data: { accessToken: 'a', expiresIn: 900, user: patient },
      },
    }));
    const { router } = renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Priya' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/patient/dashboard');
    expect(JSON.parse(mock.calls[0]?.data as string)).toEqual({
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
    mock = mockHttp(() =>
      fail(400, 'VALIDATION_ERROR', 'Validation failed', [
        { field: 'body.password', message: 'Must not contain your name or email' },
      ]),
    );
    renderRoutes(routes, '/register', authState(null));
    await screen.findByRole('heading', { name: 'Create your patient account' });
    const user = await fillValid();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Must not contain your name or email')).toBeInTheDocument();
  });
});
