import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

const admin = makeUser('admin', { id: 'me' });

describe('Lab test form', () => {
  it('adds and removes parameters and ranges, blocks low ≥ high, and sends clean data', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(url('/lab-tests'), async ({ request }) => {
        bodies.push(await request.json());
        return ok({ id: 'lt1', name: 'Complete Blood Count' }, { status: 201 });
      }),
      http.get(url('/lab-tests/lt1'), () => fail(404, 'NOT_FOUND', 'Lab test not found')),
    );
    const { router } = renderRoutes(routes, '/admin/lab-tests/new', authState(admin));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Code'), 'cbc');
    await user.type(screen.getByLabelText('Test name'), 'Complete Blood Count');
    await user.type(screen.getByLabelText('Price'), '350');
    await user.type(screen.getByLabelText('Turnaround (hours)'), '6');

    // Parameter 1 (number) starts with one range.
    let p1 = screen.getByRole('group', { name: 'Parameter 1' });
    await user.type(within(p1).getByLabelText('Key'), 'hb');
    await user.type(within(p1).getByLabelText('Name'), 'Haemoglobin');
    await user.type(within(p1).getByLabelText('Unit'), 'g/dL');

    // Add a second range and remove it again.
    await user.click(within(p1).getByRole('button', { name: 'Add range to parameter 1' }));
    expect(within(p1).getByRole('group', { name: 'Parameter 1, range 2' })).toBeInTheDocument();
    await user.click(within(p1).getByRole('button', { name: 'Remove range 2 of parameter 1' }));
    expect(
      within(p1).queryByRole('group', { name: 'Parameter 1, range 2' }),
    ).not.toBeInTheDocument();

    const range = within(p1).getByRole('group', { name: 'Parameter 1, range 1' });
    await user.selectOptions(within(range).getByLabelText('Gender'), 'male');
    await user.type(within(range).getByLabelText('Low'), '17');
    await user.type(within(range).getByLabelText('High'), '13');

    // Add parameter 2 (option), then a third that we remove.
    await user.click(screen.getByRole('button', { name: 'Add parameter' }));
    const p2 = screen.getByRole('group', { name: 'Parameter 2' });
    await user.type(within(p2).getByLabelText('Key'), 'abo');
    await user.type(within(p2).getByLabelText('Name'), 'ABO group');
    await user.selectOptions(within(p2).getByLabelText('Value type'), 'option');
    expect(within(p2).queryByText('Reference ranges')).not.toBeInTheDocument();
    await user.type(within(p2).getByLabelText('Options'), 'A{Enter}');

    await user.click(screen.getByRole('button', { name: 'Add parameter' }));
    expect(screen.getByRole('group', { name: 'Parameter 3' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove parameter 3' }));
    expect(screen.queryByRole('group', { name: 'Parameter 3' })).not.toBeInTheDocument();

    // low ≥ high and a single option are blocked on the client.
    await user.click(screen.getByRole('button', { name: 'Create lab test' }));
    expect(await within(range).findByText('Must be greater than low')).toBeInTheDocument();
    expect(within(p2).getByText('Give at least 2 different options')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);

    // Fix and submit.
    p1 = screen.getByRole('group', { name: 'Parameter 1' });
    await user.clear(within(range).getByLabelText('Low'));
    await user.type(within(range).getByLabelText('Low'), '13');
    await user.clear(within(range).getByLabelText('High'));
    await user.type(within(range).getByLabelText('High'), '17');
    await user.type(within(range).getByLabelText('Critical low'), '7');
    await user.type(within(p2).getByLabelText('Options'), 'B{Enter}');
    await user.click(screen.getByRole('button', { name: 'Create lab test' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      code: 'CBC',
      name: 'Complete Blood Count',
      category: 'haematology',
      sampleType: 'blood',
      pricePaise: 35_000,
      turnaroundHours: 6,
      preparation: '',
      parameters: [
        {
          key: 'hb',
          name: 'Haemoglobin',
          unit: 'g/dL',
          valueType: 'number',
          ranges: [{ gender: 'male', low: 13, high: 17, criticalLow: 7 }],
        },
        { key: 'abo', name: 'ABO group', valueType: 'option', options: ['A', 'B'] },
      ],
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/lab-tests/lt1'));
  });

  it('shows server errors on the parameter field they belong to', async () => {
    server.use(
      http.post(url('/lab-tests'), () =>
        fail(400, 'VALIDATION_ERROR', 'Validation failed', [
          {
            field: 'body.parameters.0.ranges.0.gender',
            message: 'Overlaps the male, ages 0–17 range',
          },
        ]),
      ),
    );
    renderRoutes(routes, '/admin/lab-tests/new', authState(admin));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Code'), 'esr');
    await user.type(screen.getByLabelText('Test name'), 'ESR');
    await user.type(screen.getByLabelText('Price'), '150');
    const p1 = screen.getByRole('group', { name: 'Parameter 1' });
    await user.type(within(p1).getByLabelText('Key'), 'esr');
    await user.type(within(p1).getByLabelText('Name'), 'ESR');
    const range = within(p1).getByRole('group', { name: 'Parameter 1, range 1' });
    await user.type(within(range).getByLabelText('High'), '15');
    await user.click(screen.getByRole('button', { name: 'Create lab test' }));
    expect(
      await within(range).findByText('Overlaps the male, ages 0–17 range'),
    ).toBeInTheDocument();
  });
});
