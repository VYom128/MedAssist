import { ClinicSettings } from '../src/modules/settings/model.js';
import { clearSettingsCache, getSettings } from '../src/modules/settings/service.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

let admin: LoggedIn;

const PUBLIC_KEYS = [
  'address',
  'ai',
  'appointment',
  'currency',
  'email',
  'logoUrl',
  'name',
  'phone',
  'tagline',
  'timezone',
  'website',
  'workingDays',
];

describe('/settings', () => {
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
  });

  describe('GET /settings/public', () => {
    it('works without a token, creates the defaults, and shows only the public subset', async () => {
      const res = await api().get('/api/v1/settings/public');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data).sort()).toEqual(PUBLIC_KEYS);
      expect(res.body.data).toMatchObject({
        name: 'MedAssist Clinic',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        workingDays: [1, 2, 3, 4, 5, 6],
        appointment: { allowPatientSelfBooking: true, bookingWindowDays: 30 },
        ai: { explanationLanguages: ['en', 'hi'] },
      });
      expect(Object.keys(res.body.data.appointment).sort()).toEqual([
        'allowPatientSelfBooking',
        'bookingWindowDays',
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/gstin|invoicePrefix|requireDualVerification/);
      expect(await ClinicSettings.countDocuments()).toBe(1);
    });
  });

  describe('GET /settings (admin)', () => {
    it('returns every setting with the §6.5 defaults', async () => {
      const res = await api().get('/api/v1/settings').set(admin.auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
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
          paymentMethods: ['cash', 'card', 'upi', 'insurance', 'other'],
        },
        lab: { requireDualVerification: true, criticalAlertEnabled: true },
        ai: { enabled: true, clinicalSummaryEnabled: true, patientExplanationEnabled: true },
        notifications: { emailEnabled: true },
      });
    });

    it('is admin-only', async () => {
      const doctor = await loginAs('doctor');
      expect((await api().get('/api/v1/settings').set(doctor.auth)).status).toBe(403);
      expect((await api().get('/api/v1/settings')).status).toBe(401);
    });
  });

  describe('PATCH /settings', () => {
    it('deep-merges a partial update, audits only the changed fields, and refreshes the cache', async () => {
      await getSettings(); // warm the cache with the defaults
      const res = await api()
        .patch('/api/v1/settings')
        .set(admin.auth)
        .send({
          name: 'Sunrise Clinic',
          address: { city: 'Bengaluru' },
          appointment: { minCancelHours: 4, bookingWindowDays: 30 },
          billing: { defaultTaxRateBps: 1800, paymentMethods: ['cash', 'upi'] },
          workingDays: [1, 2, 3, 4, 5],
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Sunrise Clinic',
        address: { city: 'Bengaluru', country: 'India' },
        appointment: { minCancelHours: 4, bookingWindowDays: 30, defaultSlotMinutes: 15 },
        billing: { defaultTaxRateBps: 1800, paymentMethods: ['cash', 'upi'], taxLabel: 'GST' },
        workingDays: [1, 2, 3, 4, 5],
        updatedBy: admin.user._id.toString(),
      });

      // The cache was refreshed: the public endpoint shows the new values at once.
      const pub = await api().get('/api/v1/settings/public');
      expect(pub.body.data).toMatchObject({ name: 'Sunrise Clinic', workingDays: [1, 2, 3, 4, 5] });
      expect((await getSettings()).appointment?.minCancelHours).toBe(4);

      const [entry] = await auditEntries('settings.update');
      expect([...(entry?.changes?.fields ?? [])].sort()).toEqual([
        'address.city',
        'appointment.minCancelHours',
        'billing.defaultTaxRateBps',
        'billing.paymentMethods',
        'name',
        'workingDays',
      ]);
      expect(entry?.changes?.before).toMatchObject({
        name: 'MedAssist Clinic',
        'appointment.minCancelHours': 2,
        'address.city': null,
      });
      expect(entry?.changes?.after).toMatchObject({
        name: 'Sunrise Clinic',
        'appointment.minCancelHours': 4,
      });
    });

    it('writes no audit entry when nothing changes', async () => {
      const res = await api()
        .patch('/api/v1/settings')
        .set(admin.auth)
        .send({ timezone: 'Asia/Kolkata' });
      expect(res.status).toBe(200);
      expect(await auditEntries('settings.update')).toHaveLength(0);
    });

    it('clears optional text with null or an empty string', async () => {
      await api()
        .patch('/api/v1/settings')
        .set(admin.auth)
        .send({ tagline: 'Care, close to home' });
      const res = await api()
        .patch('/api/v1/settings')
        .set(admin.auth)
        .send({ tagline: '', logoUrl: null });
      expect(res.body.data).toMatchObject({ tagline: null, logoUrl: null });
    });

    it.each([
      [{ timezone: 'Mars/Olympus' }, 'body.timezone'],
      [{ timezone: 'IST' }, 'body.timezone'],
      [{ currency: 'RUPEE' }, 'body.currency'],
      [{ workingDays: [1, 1, 2] }, 'body.workingDays'],
      [{ workingDays: [7] }, 'body.workingDays.0'],
      [{ workingDays: [] }, 'body.workingDays'],
      [{ appointment: { defaultSlotMinutes: 2 } }, 'body.appointment.defaultSlotMinutes'],
      [{ appointment: { minCancelHours: 1.5 } }, 'body.appointment.minCancelHours'],
      [{ billing: { defaultTaxRateBps: 10_001 } }, 'body.billing.defaultTaxRateBps'],
      [{ billing: { paymentMethods: ['bitcoin'] } }, 'body.billing.paymentMethods.0'],
      [{ ai: { explanationLanguages: ['fr'] } }, 'body.ai.explanationLanguages.0'],
      [{ gstin: 'NOT-A-GSTIN' }, 'body.gstin'],
      [{ logoUrl: 'javascript:alert(1)' }, 'body.logoUrl'],
      [{ appointment: { unknownRule: 1 } }, 'body.appointment'],
      [{ key: 'other' }, 'body'],
    ])('400 for %j', async (body, field) => {
      const res = await api().patch('/api/v1/settings').set(admin.auth).send(body);
      expect(res.status).toBe(400);
      const details = expectErrorShape(res.body, 'VALIDATION_ERROR').error.details as {
        field: string;
      }[];
      expect(details.map((d) => d.field)).toContain(field);
    });

    it('accepts timezone aliases and lower-case currency', async () => {
      const res = await api()
        .patch('/api/v1/settings')
        .set(admin.auth)
        .send({ timezone: 'America/New_York', currency: 'usd' });
      expect(res.body.data).toMatchObject({ timezone: 'America/New_York', currency: 'USD' });
    });

    it('reloads after the TTL or a cache clear (other instances)', async () => {
      await getSettings();
      await ClinicSettings.updateOne({}, { $set: { name: 'Changed elsewhere' } });
      expect((await getSettings()).name).toBe('MedAssist Clinic'); // still cached
      clearSettingsCache();
      expect((await getSettings()).name).toBe('Changed elsewhere');
    });
  });
});
