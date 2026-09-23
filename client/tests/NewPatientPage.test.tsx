import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';
import { receptionView } from './patients.fixtures';

const reception = makeUser('receptionist');
const MATCH = {
  id: 'p1',
  mrn: 'MRN-000001',
  fullName: 'Priya Sharma',
  dateOfBirth: '1990-05-17',
  phone: '+919876543210',
  isActive: true,
  matchedOn: ['phone_dob'],
};

async function fillForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('First name'), 'Priti');
  await user.type(screen.getByLabelText('Last name'), 'Sharma');
  await user.type(screen.getByLabelText('Date of birth'), '1990-05-17');
  await user.selectOptions(screen.getByLabelText('Gender'), 'female');
  await user.type(screen.getByLabelText('Mobile number'), '98765 43210'); // after the +91 prefix
  await user.click(screen.getByRole('switch', { name: 'Consent to data processing (required)' }));
  return user;
}

describe('NewPatientPage', () => {
  let created: Record<string, unknown> | undefined;
  beforeEach(() => {
    created = undefined;
    server.use(
      http.post(url('/patients'), async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return ok(receptionView({ id: 'p2', mrn: 'MRN-000002', fullName: 'Priti Sharma' }), {
          status: 201,
        });
      }),
      http.get(url('/patients/p2'), () =>
        ok(receptionView({ id: 'p2', mrn: 'MRN-000002', fullName: 'Priti Sharma' })),
      ),
    );
  });

  it('shows possible existing patients and needs a reason to create a different person', async () => {
    let checked: URLSearchParams | undefined;
    server.use(
      http.get(url('/patients/check-duplicate'), ({ request }) => {
        checked = new URL(request.url).searchParams;
        return ok({ matches: [MATCH] });
      }),
    );
    const { router } = renderRoutes(routes, '/reception/patients/new', authState(reception));
    await screen.findByRole('heading', { name: 'New patient' });
    const user = await fillForm();

    const panel = await screen.findByRole(
      'region',
      { name: 'Possible existing patient' },
      { timeout: 3000 },
    );
    expect(checked?.get('phone')).toBe('+919876543210');
    expect(checked?.get('dateOfBirth')).toBe('1990-05-17');
    expect(panel).toHaveTextContent('MRN-000001');
    expect(panel).toHaveTextContent('same phone and date of birth');
    expect(within(panel).getByRole('link', { name: /Open existing record/ })).toHaveAttribute(
      'href',
      '/reception/patients/p1',
    );

    await user.click(within(panel).getByRole('button', { name: 'This is a different person' }));
    const dialog = await screen.findByRole('dialog', { name: 'A different person?' });
    await user.click(within(dialog).getByRole('button', { name: 'Save as a new patient' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 10 characters'),
    ).toBeInTheDocument();
    expect(created).toBeUndefined();

    await user.type(
      within(dialog).getByLabelText('Why is this a different person?'),
      'Twin sister, same phone',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save as a new patient' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/reception/patients/p2'));
    expect(created).toMatchObject({
      firstName: 'Priti',
      phone: '+919876543210',
      dateOfBirth: '1990-05-17',
      gender: 'female',
      consent: { dataProcessing: true, aiExplanations: true },
      force: true,
      reason: 'Twin sister, same phone',
    });
  });

  it('shows the same panel when the server answers 409 DUPLICATE_PATIENT', async () => {
    server.use(
      http.get(url('/patients/check-duplicate'), () => ok({ matches: [] })),
      http.post(url('/patients'), () =>
        fail(409, 'DUPLICATE_PATIENT', 'Possible duplicate', { matches: [MATCH] }),
      ),
    );
    renderRoutes(routes, '/reception/patients/new', authState(reception));
    await screen.findByRole('heading', { name: 'New patient' });
    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: 'Register patient' }));
    const panel = await screen.findByRole('region', { name: 'Possible existing patient' });
    expect(panel).toHaveTextContent('Priya Sharma');
  });

  it('requires consent to data processing', async () => {
    server.use(http.get(url('/patients/check-duplicate'), () => ok({ matches: [] })));
    renderRoutes(routes, '/reception/patients/new', authState(reception));
    await screen.findByRole('heading', { name: 'New patient' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(
      await screen.findByText('Consent to data processing is required to register a patient'),
    ).toBeInTheDocument();
    expect(created).toBeUndefined();
  });

  it('saves, shows the MRN and offers a portal invite when an email was given', async () => {
    server.use(http.get(url('/patients/check-duplicate'), () => ok({ matches: [] })));
    const { router } = renderRoutes(routes, '/reception/patients/new', authState(reception));
    await screen.findByRole('heading', { name: 'New patient' });
    const user = await fillForm();
    await user.type(screen.getByLabelText('Email (optional)'), 'priti@example.com');
    await user.click(screen.getByRole('button', { name: 'Add allergy' }));
    await user.type(screen.getByLabelText('Substance 1'), 'Peanuts');
    await user.selectOptions(screen.getByLabelText('Severity 1'), 'moderate');
    await user.click(screen.getByRole('button', { name: 'Register patient' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/reception/patients/p2'));
    expect(created).toMatchObject({
      email: 'priti@example.com',
      allergies: [{ substance: 'Peanuts', reaction: null, severity: 'moderate' }],
    });
    expect(created).not.toHaveProperty('force');
    expect(
      await screen.findByText(/Invite Priya to the patient portal/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});
