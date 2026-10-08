import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { Invoice } from '../src/features/billing/api';
import { routes } from '../src/routes/routes';
import { daySummary, invoice, issued, line, listItem, listMeta, payment } from './billing.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

/** Billing screens (Phase 7): editor, payments, refunds, void, patient view, money formatting. */

// The pages are lazy routes: load them once up front, so the first test does not wait for a
// cold compile of the chunk (that made the first test time out intermittently).
beforeAll(async () => {
  await Promise.all([
    import('../src/features/billing/pages/InvoiceDetailPage'),
    import('../src/features/billing/pages/InvoicesListPage'),
    import('../src/features/billing/pages/MyInvoicesPage'),
    import('../src/features/billing/pages/DayClosePage'),
  ]);
}, 30_000);

const reception = makeUser('receptionist', { id: 'r1', firstName: 'Riya', lastName: 'Desk' });
const admin = makeUser('admin', { id: 'ad1' });
const patient = makeUser('patient', { id: 'pu1', patientId: 'p1', patientLinkStatus: 'linked' });

/** Catalogue lists the "Add line" panel loads. */
const catalogue = [
  http.get(url('/services'), () => ok([], { meta: listMeta(0) })),
  http.get(url('/lab-tests'), () => ok([], { meta: listMeta(0) })),
];

/** Serves invoice inv1 (GET) and its payments; PATCH answers with `onPatch`. */
function serveInvoice(
  current: Invoice,
  {
    payments = [],
    onPatch,
  }: {
    payments?: ReturnType<typeof payment>[];
    onPatch?: (body: Record<string, unknown>) => Response;
  } = {},
) {
  const patches: Record<string, unknown>[] = [];
  server.use(
    ...catalogue,
    http.get(url('/invoices/inv1'), () => ok(current)),
    http.get(url('/invoices/inv1/payments'), () => ok(payments)),
    http.patch(url('/invoices/inv1'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return onPatch ? onPatch(body) : ok(current);
    }),
  );
  return patches;
}

const discountInput = (lineNo = 1) =>
  within(screen.getByRole('listitem', { name: new RegExp(`^Line ${lineNo}`) })).getByLabelText(
    'Discount',
  );

describe('draft invoice editor', () => {
  it('shows the server totals after saving, not the client preview', async () => {
    const user = userEvent.setup();
    const patches = serveInvoice(invoice(), {
      // The server's own calculation differs from the preview (e.g. a tax rule): it wins.
      onPatch: () =>
        ok(
          invoice({
            revision: 1,
            items: [
              line({
                discountPaise: 1000,
                taxPaise: 1620,
                lineTotalPaise: 10_620,
                taxRateBps: 1800,
              }),
            ],
            discountTotalPaise: 1000,
            taxTotalPaise: 1620,
            totalPaise: 10_620,
            balancePaise: 10_620,
          }),
        ),
    });
    renderRoutes(routes, '/reception/invoices/inv1', authState(reception));

    await user.type(await screenFind(), '10');
    // The live preview (client-side): ₹100 − ₹10 = ₹90.
    const preview = await screen.findByTestId('totals-preview');
    expect(within(preview).getByText('₹90.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save now/i }));
    await waitFor(() =>
      expect(within(screen.getByTestId('totals')).getByText('₹106.20')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('totals-preview')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    // Only the line ids and inputs were sent – never totals.
    expect(patches[0]).toEqual({
      expectedVersion: 0,
      items: [
        {
          id: 'l1',
          discountPaise: 1000,
          quantity: 1,
          description: 'Dressing',
          unitPricePaise: 10_000,
        },
      ],
      notes: null,
      dueDate: null,
    });
  });

  it('a 409 conflict stops autosave and offers "Reload latest"', async () => {
    const user = userEvent.setup();
    let fresh = false;
    server.use(
      ...catalogue,
      http.get(url('/invoices/inv1'), () =>
        ok(fresh ? invoice({ revision: 3, notes: 'Changed elsewhere' }) : invoice()),
      ),
      http.patch(url('/invoices/inv1'), () =>
        fail(409, 'CONFLICT', 'This invoice was changed by someone else.', { currentRevision: 3 }),
      ),
    );
    renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    await user.type(await screenFind(), '5');
    await user.click(screen.getByRole('button', { name: /save now/i }));

    const banner = await screen.findByText('This invoice was changed by someone else');
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save now/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /issue invoice/i })).toBeDisabled();

    fresh = true;
    await user.click(screen.getByRole('button', { name: /reload latest/i }));
    await waitFor(() =>
      expect(
        screen.queryByText('This invoice was changed by someone else'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Notes')).toHaveValue('Changed elsewhere');
    expect(discountInput()).toHaveValue('0');
  });

  it('the receptionist is told an admin must approve; the admin can save the same discount', async () => {
    const user = userEvent.setup();
    serveInvoice(invoice(), {
      onPatch: () =>
        fail(
          422,
          'DISCOUNT_REQUIRES_ADMIN',
          'Discounts above 10% of the bill need an administrator',
          {
            maxPercent: 10,
            discountPercent: 25,
          },
        ),
    });
    const desk = renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    await user.type(await screenFind(), '25');
    expect(await screen.findByText(/an admin must approve it/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save now/i }));
    expect(
      await screen.findByText(/An admin must approve a discount above 10% of the bill/),
    ).toBeInTheDocument();
    desk.unmount();

    serveInvoice(invoice(), {
      onPatch: () =>
        ok(
          invoice({
            revision: 1,
            items: [line({ discountPaise: 2500, lineTotalPaise: 7500 })],
            discountTotalPaise: 2500,
            totalPaise: 7500,
            balancePaise: 7500,
            discountPercent: 25,
            discountApproval: { at: '2026-10-06T06:00:00Z', byName: 'Admin User' },
          }),
        ),
    });
    renderRoutes(routes, '/admin/invoices/inv1', authState(admin));
    expect(await screen.findByText(/As an admin you can approve discounts/)).toBeInTheDocument();
    await user.type(await screenFind(), '25');
    await user.click(screen.getByRole('button', { name: /save now/i }));
    await waitFor(() =>
      expect(within(screen.getByTestId('totals')).getByText('₹75.00')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/An admin must approve a discount above/)).not.toBeInTheDocument();
  });
});

/** The first line's discount input (after the page loads). */
async function screenFind() {
  await screen.findByRole('list', { name: 'Invoice lines' });
  const input = discountInput();
  await userEvent.setup().clear(input);
  return input;
}

describe('payments on an issued invoice', () => {
  it('the payment modal defaults to the balance, needs a reference for UPI/card, and shows PAYMENT_EXCEEDS_BALANCE', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    serveInvoice(issued());
    server.use(
      http.post(url('/invoices/inv1/payments'), async ({ request }) => {
        posted.push(await request.json());
        return fail(422, 'PAYMENT_EXCEEDS_BALANCE', 'The amount is more than the balance due', {
          balancePaise: 20_000,
        });
      }),
    );
    renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    expect(await screen.findByTestId('balance-due')).toHaveTextContent('₹500.00');
    await user.click(screen.getByRole('button', { name: /record payment/i }));
    const dialog = await screen.findByRole('dialog', { name: /record payment/i });
    expect(within(dialog).getByLabelText('Amount received')).toHaveValue('500');

    await user.selectOptions(within(dialog).getByLabelText('Method'), 'upi');
    await user.click(within(dialog).getByRole('button', { name: /record payment/i }));
    expect(await within(dialog).findByText('Enter the UPI transaction ID')).toBeInTheDocument();
    expect(posted).toHaveLength(0);

    await user.selectOptions(within(dialog).getByLabelText('Method'), 'card');
    await user.click(within(dialog).getByRole('button', { name: /record payment/i }));
    expect(await within(dialog).findByText('Enter the card slip number')).toBeInTheDocument();
    expect(posted).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Card slip number'), 'SLIP 4421');
    await user.click(within(dialog).getByRole('button', { name: /record payment/i }));
    expect(await within(dialog).findByText(/Only ₹200.00 is still due/)).toBeInTheDocument();
    expect(posted).toEqual([{ amountPaise: 50_000, method: 'card', reference: 'SLIP 4421' }]);
    expect(within(dialog).getByLabelText('Amount received')).toHaveValue('200');
  });

  it('the refund modal caps the amount at what is left of the payment', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    serveInvoice(
      issued({ status: 'partially_paid', amountPaidPaise: 20_000, balancePaise: 30_000 }),
      {
        payments: [
          payment({ refundedPaise: 10_000, refundablePaise: 20_000 }),
          payment({
            id: 'ref1',
            paymentNumber: 'PAY-2026-000011',
            kind: 'refund',
            amountPaise: -10_000,
            refundOf: 'pay1',
            reason: 'Test not done',
            refundedPaise: undefined,
            refundablePaise: undefined,
          }),
        ],
      },
    );
    server.use(
      http.post(url('/payments/pay1/refund'), async ({ request }) => {
        posted.push(await request.json());
        return ok(
          { refund: payment({ id: 'ref2', kind: 'refund' }), invoice: issued() },
          { status: 201 },
        );
      }),
    );
    renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    // The refund is nested under its payment.
    expect(await screen.findByText('PAY-2026-000011')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^refund$/i }));
    const dialog = await screen.findByRole('dialog', { name: /refund PAY-2026-000010/i });
    expect(within(dialog).getByTestId('refundable')).toHaveTextContent('₹200.00');
    const amount = within(dialog).getByLabelText('Amount to refund');
    expect(amount).toHaveValue('200');

    await user.clear(amount);
    await user.type(amount, '250');
    await user.type(within(dialog).getByLabelText('Reason'), 'Patient overcharged');
    await user.click(within(dialog).getByRole('button', { name: /^refund$/i }));
    expect(
      await within(dialog).findByText('At most ₹200.00 can be refunded from this payment'),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(0);

    await user.clear(amount);
    await user.type(amount, '200');
    await user.click(within(dialog).getByRole('button', { name: /^refund$/i }));
    await waitFor(() =>
      expect(posted).toEqual([{ amountPaise: 20_000, reason: 'Patient overcharged' }]),
    );
  });

  it('void is disabled with an explanation while money is held, enabled when nothing is paid', async () => {
    serveInvoice(
      issued({ status: 'partially_paid', amountPaidPaise: 20_000, balancePaise: 30_000 }),
      {
        payments: [payment({ amountPaise: 20_000, refundablePaise: 20_000 })],
      },
    );
    const held = renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    const button = await screen.findByRole('button', { name: /void invoice/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/₹200.00 is still paid on this invoice/);
    held.unmount();

    serveInvoice(issued());
    renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    expect(await screen.findByRole('button', { name: /void invoice/i })).toBeEnabled();
  });

  it('shows the cancelled tests that were billed', async () => {
    serveInvoice(
      issued({
        cancelledItemsBilled: [
          {
            lineId: 'l1',
            description: 'Lipid profile',
            lineTotalPaise: 45_000,
            labOrderId: 'lo1',
            itemId: 'i1',
            at: '2026-10-06T08:00:00Z',
          },
        ],
      }),
    );
    renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    expect(await screen.findByText('Cancelled tests were billed')).toBeInTheDocument();
    expect(screen.getByText('Lipid profile')).toBeInTheDocument();
  });
});

describe('patients', () => {
  it('never shows drafts in the list and asks to pay at reception', async () => {
    server.use(
      http.get(url('/invoices'), ({ request }) => {
        // The portal list never asks for drafts.
        expect(new URL(request.url).searchParams.get('status')).toBeNull();
        return ok(
          [
            listItem(),
            listItem({ id: 'inv2', invoiceNumber: null, status: 'draft' }),
            listItem({
              id: 'inv3',
              invoiceNumber: 'INV-2026-000043',
              status: 'paid',
              balancePaise: 0,
            }),
          ],
          { meta: listMeta(3, { billedPaise: 0, collectedPaise: 0, outstandingPaise: 100_000 }) },
        );
      }),
    );
    renderRoutes(routes, '/patient/invoices', authState(patient));
    expect(await screen.findAllByText('INV-2026-000042')).not.toHaveLength(0);
    expect(screen.getAllByText('INV-2026-000043')).not.toHaveLength(0);
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.getAllByText('₹1,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Please pay at the clinic reception/).length).toBeGreaterThan(0);
  });

  it('the invoice page: no desk actions, the PDF, and the pay-at-reception note', async () => {
    server.use(
      http.get(url('/invoices/inv1'), () =>
        ok({ ...issued(), rules: undefined, notes: undefined }),
      ),
      http.get(url('/invoices/inv1/payments'), () =>
        ok([payment({ reference: '••••4421', receivedByName: undefined, reason: undefined })]),
      ),
    );
    renderRoutes(routes, '/patient/invoices/inv1', authState(patient));
    expect(await screen.findByText('Please pay at the clinic reception')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download invoice/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^receipt$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /void invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^refund$/i })).not.toBeInTheDocument();
  });

  it('a draft (or someone else’s invoice) is not found', async () => {
    server.use(http.get(url('/invoices/inv9'), () => fail(404, 'NOT_FOUND', 'Invoice not found')));
    renderRoutes(routes, '/patient/invoices/inv9', authState(patient));
    expect(await screen.findByText(/does not exist or is not available/)).toBeInTheDocument();
  });
});

describe('money from paise', () => {
  it('in the list and its summary strip', async () => {
    server.use(
      http.get(url('/invoices'), () =>
        ok([listItem()], {
          meta: listMeta(1, {
            billedPaise: 12_345_678,
            collectedPaise: 23_456,
            outstandingPaise: 100_000,
          }),
        }),
      ),
    );
    renderRoutes(routes, '/reception/invoices', authState(reception));
    expect((await screen.findAllByText('₹1,234.56')).length).toBeGreaterThan(0);
    expect(screen.getByText('₹1,23,456.78')).toBeInTheDocument();
    expect(screen.getAllByText('₹234.56').length).toBeGreaterThan(0);
  });

  it('in the detail: lines, totals and the amount in words', async () => {
    serveInvoice(
      issued({
        items: [
          line({
            unitPricePaise: 125_050,
            grossPaise: 125_050,
            taxablePaise: 125_050,
            lineTotalPaise: 125_050,
          }),
        ],
        subtotalPaise: 125_050,
        totalPaise: 125_050,
        balancePaise: 125_050,
      }),
    );
    renderRoutes(routes, '/reception/invoices/inv1', authState(reception));
    expect(await screen.findByTestId('balance-due')).toHaveTextContent('₹1,250.50');
    expect(
      screen.getByText('Rupees One Thousand Two Hundred Fifty and Fifty Paise Only'),
    ).toBeInTheDocument();
  });

  it('on the day close page', async () => {
    server.use(http.get(url('/payments/summary'), () => ok(daySummary())));
    renderRoutes(routes, '/reception/billing/day-close?date=2026-10-06', authState(reception));
    expect(await screen.findByTestId('day-net')).toHaveTextContent('₹12,445.49');
    expect(screen.getByTestId('day-collected')).toHaveTextContent('₹15,099.99');
    expect(screen.getByTestId('day-refunded')).toHaveTextContent('−₹2,654.50');
    expect(screen.getByText('₹12,345.50')).toBeInTheDocument();
    expect(screen.getByText('₹10,000.00')).toBeInTheDocument();
  });
});
