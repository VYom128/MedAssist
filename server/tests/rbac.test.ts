import type { Role } from '../src/config/constants.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { loginAs, resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { buildContext, PLACEHOLDER_IDS, send } from './helpers/rbacContext.js';
import { ALL, ENDPOINTS, PUBLIC_ENDPOINTS, routeKey, type Ctx } from './helpers/rbacMatrix.js';
import { api } from './helpers/testApp.js';

/**
 * RBAC matrix (spec §2.4, §15.1): every row of tests/helpers/rbacMatrix.ts × every role. A role
 * in `roles` must get exactly `status` (with a full set of records); every other role gets 403.
 */

const LOGIN_REUSE_MS = 5 * 60_000; // well inside the 15-minute access token
const logins = new Map<Role, { me: Ctx['me']; at: number }>();

/**
 * Context for a role the row does not allow: `authorize()` answers 403 before any record is
 * read, so a login of that role and ids that match nothing are enough (one login per role,
 * renewed every few minutes). A route that wrongly let the role through would answer 2xx, 400 or
 * 404 instead and still fail the row.
 */
async function deniedContext(role: Role): Promise<Ctx> {
  const cached = logins.get(role);
  if (cached && Date.now() - cached.at < LOGIN_REUSE_MS)
    return { ...PLACEHOLDER_IDS, me: cached.me };
  const me = await loginAs(role);
  logins.set(role, { me, at: Date.now() });
  return { ...PLACEHOLDER_IDS, me };
}

/** Keys a public (no token) response must never contain. */
const PRIVATE_KEYS =
  /"(email|phone|registrationNumber|roomNumber|slotMinutes|gstin|invoicePrefix|isActive|activeDoctors|lockVersion|bookingVersion|createdBy|updatedBy|passwordHash)"/;

/**
 * The kiosk board shows doctor names and rooms (spec §4.6) but nothing about patients and no ids.
 */
const PRIVATE_BOARD_KEYS =
  /"(id|_id|\w*Id|email|phone|mrn|patient\w*|firstName|lastName|appointment\w*|registrationNumber|isActive|createdBy|updatedBy)"/;

/** Public clinic settings include the clinic's own contact email/phone (spec §7.4), nothing else. */
const PRIVATE_SETTINGS_KEYS =
  /"(registrationNumber|gstin|invoicePrefix|defaultTaxRateBps|requireDualVerification|updatedBy)"/;

/** Audit entries other than denials, after queued writes finish. */
async function auditCount() {
  await flushAudit();
  return AuditLog.countDocuments({ action: { $ne: 'access.denied' } });
}

describe('RBAC matrix', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Promise.all([
      Appointment.init(),
      Encounter.init(),
      Prescription.init(),
      LabOrder.init(),
      Invoice.init(),
      Payment.init(),
      ClinicalSummary.init(),
      PatientExplanation.init(),
    ]);
    await resetDb();
    emails = captureEmails(); // welcome and reset emails are sent in the background
  });
  afterAll(() => emails.restore());

  for (const row of ENDPOINTS) {
    for (const role of ALL) {
      const allowed = row.roles.includes(role);
      const expected = allowed ? (row.statusFor?.[role] ?? row.status) : 403;
      const label = routeKey(row);
      it(`${label} as ${role} → ${expected}`, async () => {
        const c = allowed ? await buildContext(role) : await deniedContext(role);
        const before = await auditCount();
        const res = await send(row, c);
        expect(res.status, JSON.stringify(res.body)).toBe(expected);
        // Every write an allowed role makes is audited (spec §10.4).
        if (allowed && expected < 400 && row.method !== 'get' && !row.unaudited) {
          expect(await auditCount(), `${label} wrote no audit entry`).toBeGreaterThan(before);
        }
      });
    }
  }

  for (const row of PUBLIC_ENDPOINTS) {
    for (const role of [...ALL, 'anonymous'] as const) {
      it(`public ${routeKey(row)} as ${role} → ${row.status}`, async () => {
        const c = await buildContext(role === 'anonymous' ? 'patient' : role);
        let req = api()[row.method](`/api/v1${row.path(c)}`);
        if (role !== 'anonymous') req = req.set(c.me.auth);
        const res = await req;
        expect(res.status, JSON.stringify(res.body)).toBe(row.status);
        if (role === 'anonymous') {
          // Public responses never carry contact details, registration numbers or admin fields.
          const privateKeys =
            routeKey(row) === 'GET /settings/public'
              ? PRIVATE_SETTINGS_KEYS
              : routeKey(row) === 'GET /queue/board'
                ? PRIVATE_BOARD_KEYS
                : PRIVATE_KEYS;
          expect(JSON.stringify(res.body)).not.toMatch(privateKeys);
        }
      });
    }
  }

  it('every protected endpoint returns 401 without a token', async () => {
    for (const row of ENDPOINTS) {
      const res = await send(row, null);
      expect(res.status, `${row.method} ${row.path({} as Ctx)}`).toBe(401);
    }
  });
});
