import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import toast from 'react-hot-toast';
import type { AdminSettings } from '../src/features/settings/api';
import { routes } from '../src/routes/routes';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

const SETTINGS: AdminSettings = {
  name: 'MedAssist Clinic',
  logoUrl: null,
  tagline: null,
  registrationNumber: null,
  gstin: null,
  address: {
    line1: null,
    line2: null,
    city: 'Bengaluru',
    state: null,
    postalCode: null,
    country: 'India',
  },
  phone: null,
  email: null,
  website: null,
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  workingDays: [1, 2, 3, 4, 5, 6],
  appointment: {
    defaultSlotMinutes: 15,
    bookingWindowDays: 30,
    minCancelHours: 2,
    allowPatientSelfBooking: true,
    maxActiveBookingsPerPatient: 3,
    walkInOverbookPerSession: 2,
    noShowGraceMinutes: 30,
    reminderHoursBefore: 24,
  },
  billing: {
    invoicePrefix: 'INV',
    defaultTaxRateBps: 0,
    taxLabel: 'GST',
    maxDiscountPercentWithoutAdmin: 10,
    paymentMethods: ['cash', 'card', 'upi'],
    invoiceFooter: null,
  },
  lab: { requireDualVerification: true, criticalAlertEnabled: true },
  ai: {
    enabled: true,
    clinicalSummaryEnabled: true,
    patientExplanationEnabled: true,
    explanationLanguages: ['en', 'hi'],
  },
  notifications: { emailEnabled: true },
  updatedBy: null,
  updatedAt: '2026-09-20T05:00:00.000Z',
};

const admin = makeUser('admin', { id: 'me' });

describe('SettingsPage', () => {
  let patches: unknown[];
  beforeEach(() => {
    patches = [];
    server.use(
      http.get(url('/settings'), () => ok(SETTINGS)),
      http.patch(url('/settings'), async ({ request }) => {
        const body = (await request.json()) as Record<string, Record<string, unknown>>;
        patches.push(body);
        return ok({
          ...SETTINGS,
          ...body,
          appointment: { ...SETTINGS.appointment, ...body.appointment },
          billing: { ...SETTINGS.billing, ...body.billing },
        });
      }),
    );
  });

  const open = async () => {
    renderRoutes(routes, '/admin/settings', authState(admin));
    await screen.findByLabelText('Clinic name');
    return userEvent.setup();
  };

  it('saves only the changed fields, with tax as basis points', async () => {
    const toastSuccess = vi.spyOn(toast, 'success');
    const user = await open();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('tab', { name: 'Appointments' }));
    const cancel = screen.getByLabelText('Cancel / reschedule up to (hours before)');
    await user.clear(cancel);
    await user.type(cancel, '4');

    await user.click(screen.getByRole('tab', { name: 'Billing' }));
    const tax = screen.getByLabelText('Default tax rate (%)');
    await user.clear(tax);
    await user.type(tax, '18');
    await user.click(screen.getByRole('button', { name: 'Card' })); // turn card off

    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      appointment: { minCancelHours: 4 },
      billing: { defaultTaxRateBps: 1800, paymentMethods: ['cash', 'upi'] },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Settings saved'));
    await waitFor(() => expect(save).toBeDisabled());
  });

  it('working days are toggle buttons', async () => {
    const user = await open();
    const sunday = screen.getByRole('button', { name: 'Sun' });
    expect(sunday).toHaveAttribute('aria-pressed', 'false');
    await user.click(sunday);
    expect(sunday).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches[0]).toEqual({ workingDays: [1, 2, 3, 4, 5, 6, 0] }));
  });

  it('client validation marks the tab with the error', async () => {
    const user = await open();
    await user.click(screen.getByRole('tab', { name: 'Billing' }));
    const tax = screen.getByLabelText('Default tax rate (%)');
    await user.clear(tax);
    await user.type(tax, '150');
    await user.click(screen.getByRole('tab', { name: 'Clinic' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // Switches to the tab that has the error.
    expect(await screen.findByText('At most 100')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Billing/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Billing/ })).toHaveTextContent('(has errors)');
    expect(patches).toHaveLength(0);
  });

  it('shows server field errors on the right field and tab', async () => {
    server.use(
      http.patch(url('/settings'), () =>
        fail(400, 'VALIDATION_ERROR', 'Validation failed', [
          { field: 'body.billing.defaultTaxRateBps', message: 'Too high for this clinic' },
        ]),
      ),
    );
    const user = await open();
    await user.click(screen.getByRole('tab', { name: 'Billing' }));
    const tax = screen.getByLabelText('Default tax rate (%)');
    await user.clear(tax);
    await user.type(tax, '28');
    await user.click(screen.getByRole('tab', { name: 'Clinic' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Too high for this clinic')).toBeInTheDocument();
    expect(screen.getByLabelText('Default tax rate (%)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('warns before leaving with unsaved changes', async () => {
    const user = await open();
    await user.type(screen.getByLabelText('Tagline'), 'Care, close to home');
    await user.click(screen.getByRole('link', { name: 'Services' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Tagline')).toHaveValue('Care, close to home');
  });
});
