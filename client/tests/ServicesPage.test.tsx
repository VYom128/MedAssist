import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { AdminService } from '../src/features/services/api';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

const service = (over: Partial<AdminService>): AdminService => ({
  id: 's',
  code: 'CONS-GEN',
  name: 'General consultation',
  department: { id: 'gen', name: 'General Medicine', code: 'GEN' },
  type: 'consultation',
  durationMinutes: 15,
  pricePaise: 50_000,
  taxRateBps: null,
  isActive: true,
  createdAt: null,
  updatedAt: null,
  ...over,
});
const meta = (n: number) => ({ page: 1, limit: 20, total: n, totalPages: 1 });
const admin = makeUser('admin', { id: 'me' });

describe('ServicesPage', () => {
  let lastQuery: URLSearchParams;
  beforeEach(() => {
    server.use(
      http.get(url('/services'), ({ request }) => {
        lastQuery = new URL(request.url).searchParams;
        return ok(
          [
            service({ id: 's1' }),
            service({
              id: 's2',
              code: 'PROC-DRESS',
              name: 'Wound dressing',
              department: null,
              type: 'procedure',
              pricePaise: 25_050,
              taxRateBps: 1800,
              isActive: false,
            }),
          ],
          { meta: meta(2) },
        );
      }),
      http.get(url('/departments'), () =>
        ok(
          [
            {
              id: 'gen',
              name: 'General Medicine',
              code: 'GEN',
              description: null,
              isActive: true,
              activeDoctors: 1,
              createdAt: null,
              updatedAt: null,
            },
          ],
          { meta: meta(1) },
        ),
      ),
    );
  });

  it('shows prices in ₹, tax and status', async () => {
    renderRoutes(routes, '/admin/services', authState(admin));
    const table = await screen.findByRole('table', { name: 'Services' });
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('₹500.00');
    expect(first).toHaveTextContent('Default');
    expect(second).toHaveTextContent('₹250.50');
    expect(second).toHaveTextContent('18%');
    expect(second).toHaveTextContent('Clinic-wide');
    expect(second).toHaveTextContent('Inactive');
    expect(lastQuery.get('includeInactive')).toBe('true');
  });

  it('filters by status and type through the API', async () => {
    const { router } = renderRoutes(routes, '/admin/services', authState(admin));
    await screen.findByRole('table', { name: 'Services' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
    await waitFor(() => expect(lastQuery.get('isActive')).toBe('false'));
    await user.selectOptions(screen.getByLabelText('Type'), 'procedure');
    await waitFor(() => expect(lastQuery.get('type')).toBe('procedure'));
    expect(router.state.location.search).toBe('?status=inactive&type=procedure');
  });

  it('creates a service: rupees typed, paise and basis points sent', async () => {
    let body: unknown;
    server.use(
      http.post(url('/services'), async ({ request }) => {
        body = await request.json();
        return ok(service({ id: 'new' }), { status: 201 });
      }),
    );
    renderRoutes(routes, '/admin/services', authState(admin));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add service' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add service' });
    await user.type(within(dialog).getByLabelText('Code'), 'proc-neb');
    await user.type(within(dialog).getByLabelText('Name'), 'Nebulisation');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'procedure');
    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'General Medicine' })).toBeInTheDocument(),
    );
    await user.selectOptions(within(dialog).getByLabelText('Department'), 'gen');

    const price = within(dialog).getByLabelText('Price');
    await user.type(price, 'abc');
    await user.click(within(dialog).getByRole('button', { name: 'Add service' }));
    expect(await within(dialog).findByText('Enter an amount in rupees')).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.clear(price);
    await user.type(price, '1,299.5');
    await user.type(within(dialog).getByLabelText('Tax (%)'), '18');
    await user.click(within(dialog).getByRole('button', { name: 'Add service' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(body).toEqual({
      code: 'PROC-NEB',
      name: 'Nebulisation',
      department: 'gen',
      type: 'procedure',
      durationMinutes: 15,
      pricePaise: 129_950,
      taxRateBps: 1800,
    });
  });

  it('edits keep the stored price and send changes', async () => {
    let body: unknown;
    server.use(
      http.patch(url('/services/s1'), async ({ request }) => {
        body = await request.json();
        return ok(service({ id: 's1', pricePaise: 60_000 }));
      }),
    );
    renderRoutes(routes, '/admin/services', authState(admin));
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Services' });
    await user.click(within(table).getByRole('button', { name: 'Edit General consultation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit General consultation' });
    const price = within(dialog).getByLabelText('Price');
    expect(price).toHaveValue('500');
    await user.clear(price);
    await user.type(price, '600');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(body).toMatchObject({ pricePaise: 60_000, taxRateBps: null }));
  });
});
