import mongoose, { Types } from 'mongoose';
import type { Role } from '../src/config/constants.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Document as DocumentModel } from '../src/modules/documents/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { getStorage } from '../src/services/storage/index.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createDoctor,
  createLabTest,
  createPatient,
  insertAppointment,
  insertLabOrder,
  loginAsDoctor,
  loginAsPatient,
} from './helpers/fixtures.js';
import { buildContext, send } from './helpers/rbacContext.js';
import {
  ENDPOINTS,
  MATRIX_PDF,
  OUTSIDER,
  PUBLIC_ENDPOINTS,
  routeKey,
  type Ctx,
  type Outsider,
  type Row,
} from './helpers/rbacMatrix.js';
import { API_ROUTES } from './helpers/routes.js';
import { api } from './helpers/testApp.js';

/**
 * Ownership matrix (spec §2.3, §2.5, §10.2): the RBAC matrix proves each role reaches its routes;
 * this proves a role cannot reach someone else's records through them. For every row that allows
 * a doctor or a patient, a second user of that role (a doctor with no care relationship, patient B)
 * calls the route on the records of the first (`OUTSIDER` in rbacMatrix.ts says what they get).
 * Also: lab technicians without a placed lab order, and the §2.5 field table on GET /patients/:id.
 */

type OwnerRole = 'doctor' | 'patient';
const OWNER_ROLES: readonly OwnerRole[] = ['doctor', 'patient'];

const casesRun: Record<string, number> = {};
const count = (group: string) => {
  casesRun[group] = (casesRun[group] ?? 0) + 1;
};

const isObjectId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);

/** The same context with every id replaced by one that matches no record. */
const missingIds = (c: Ctx): Ctx =>
  Object.fromEntries(
    Object.entries(c).map(([k, v]) => [k, isObjectId(v) ? new Types.ObjectId().toString() : v]),
  ) as unknown as Ctx;

/** The owner's records an outsider's list or search must never contain. */
const ownedIds = (c: Ctx) => [
  c.patientId,
  c.appointmentId,
  c.todayScheduledId,
  c.checkedInId,
  c.noShowId,
  c.inConsultationId,
  c.encounterId,
  c.signableEncounterId,
  c.signedEncounterId,
  c.prescriptionId,
  c.reissuedDraftId,
  c.draftLabOrderId,
  c.labOrderId,
  c.releasedLabOrderId,
  c.documentId,
  c.myDocumentId,
  c.draftInvoiceId,
  c.issuedInvoiceId,
  c.paidInvoiceId,
  c.paymentId,
  c.followupId,
  c.summaryId,
  c.notificationId,
];

/** What an error answer says, without the per-request `requestId`. */
const errorShape = (body: { success?: boolean; message?: string; error?: unknown }) => ({
  success: body.success,
  message: body.message,
  error: body.error,
});

/** Collections an outsider's request must leave untouched (users and sessions change on login). */
const SKIP_COLLECTIONS = new Set(['users', 'sessions', 'audit_logs', 'login_attempts']);

/** Every document of the record collections, as canonical JSON (for "nothing changed"). */
async function snapshot(): Promise<Record<string, string>> {
  const db = mongoose.connection.db!;
  const names = (await db.listCollections().toArray())
    .map((col) => col.name)
    .filter((name) => !SKIP_COLLECTIONS.has(name))
    .sort();
  const entries = await Promise.all(
    names.map(async (name) => {
      const docs = await db.collection(name).find().sort({ _id: 1 }).toArray();
      return [name, JSON.stringify(docs)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** `access.denied` entries written for `actor` since `since`. */
async function deniedEntries(actor: LoggedIn, since: Date) {
  await flushAudit();
  return AuditLog.find({
    action: 'access.denied',
    'actor.user': actor.user._id,
    at: { $gte: since },
  }).lean();
}

/**
 * Words that identify the owner patient or describe their records: none may appear in a denial
 * entry, which carries ids, the role, the reason and the request only.
 */
async function ownerWords(c: Ctx): Promise<string[]> {
  const p = await Patient.findById(c.patientId).lean();
  return [
    p!.lastName,
    p!.mrn,
    p!.phone,
    ...(p!.email ? [p!.email] : []),
    'Matrix complaint',
    'Matrix diagnosis',
    'Paracetamol',
    'Matrix question',
    'Matrix AI summary',
    'Matrix explanation',
    'Lab report',
    'Haemoglobin',
  ];
}

function expectIdsOnly(entry: Record<string, unknown>, words: string[], label: string) {
  expect(entry.outcome, label).toBe('denied');
  const json = JSON.stringify({ ...entry, actor: undefined });
  for (const word of words)
    expect(json, `${label}: denial entry names "${word}"`).not.toContain(word);
  if (entry.patient) expect(isObjectId(entry.patient.toString()), label).toBe(true);
  const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(metadata)) {
    // Reasons, scopes and record types are short codes; anything else must be an id.
    const ok =
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'string' && (/^[a-z_.]{1,40}$/.test(value) || isObjectId(value)));
    expect(ok, `${label}: metadata.${key} = ${JSON.stringify(value)}`).toBe(true);
  }
}

const ownStatus = (row: Row, role: Role) => row.statusFor?.[role] ?? row.status;

async function outsiderOf(role: OwnerRole): Promise<LoggedIn> {
  return role === 'doctor' ? loginAsDoctor() : loginAsPatient();
}

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
});

let emails: ReturnType<typeof captureEmails>;
beforeAll(() => {
  emails = captureEmails();
});
afterAll(() => emails.restore());

afterAll(() => {
  const ownerRows = ENDPOINTS.filter((r) => OWNER_ROLES.some((role) => r.roles.includes(role)));
  const lines = [
    '',
    'RBAC summary',
    `  routes mounted under /api/v1: ${API_ROUTES.length}`,
    `  matrix rows: ${ENDPOINTS.length} protected + ${PUBLIC_ENDPOINTS.length} public – every mounted route except /health and the public /auth routes (routeInventory.test.ts)`,
    `  rbac.test.ts cases: ${ENDPOINTS.length * 5 + PUBLIC_ENDPOINTS.length * 6 + 1} (5 roles × protected rows, 6 callers × public rows, 401 sweep)`,
    `  ownership rows (doctor or patient allowed): ${ownerRows.length}`,
    ...Object.entries(casesRun).map(([group, n]) => `  ${group}: ${n} cases`),
    '',
  ];
  process.stdout.write(lines.join('\n'));
});

describe('ownership matrix: every doctor/patient row declares what an outsider gets', () => {
  it('each row allowing a doctor or a patient has an OUTSIDER entry for that role', () => {
    const missing = ENDPOINTS.flatMap((row) =>
      OWNER_ROLES.filter((role) => row.roles.includes(role))
        .filter((role) => OUTSIDER[routeKey(row)]?.[role] === undefined)
        .map((role) => `${routeKey(row)} (${role})`),
    );
    expect(missing).toEqual([]);
  });

  it('each OUTSIDER entry is a matrix row that allows that role', () => {
    const extra = Object.entries(OUTSIDER).flatMap(([key, roles]) =>
      (Object.keys(roles) as OwnerRole[])
        .filter((role) => !ENDPOINTS.some((r) => routeKey(r) === key && r.roles.includes(role)))
        .map((role) => `${key} (${role})`),
    );
    expect(extra).toEqual([]);
  });
});

describe.each(OWNER_ROLES)('outsider %s on the owner’s records', (role) => {
  for (const row of ENDPOINTS.filter((r) => r.roles.includes(role))) {
    const label = routeKey(row);
    const expected = OUTSIDER[label]?.[role] as Outsider;
    it(`${label} → ${expected}`, async () => {
      count(`outsider ${role}`);
      const c = await buildContext(role);
      const outsider = await outsiderOf(role);
      const asOutsider = { ...c, me: outsider };
      const isWrite = row.method !== 'get';
      const before = isWrite ? await snapshot() : null;
      const since = new Date();
      const res = await send(row, asOutsider);
      const body = JSON.stringify(res.body);

      if (expected === 'same') {
        expect(res.status, body).toBe(ownStatus(row, role));
        return;
      }
      if (expected === 403) {
        expect(res.status, body).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        return;
      }
      if (expected === 'list') {
        expect(res.status, body).toBe(200);
        for (const id of ownedIds(c))
          expect(body, `list shows the owner's ${id}`).not.toContain(id);
        // A fresh outsider has no records: the counts must not include the owner's either.
        if (Array.isArray(res.body.data)) expect(res.body.data).toHaveLength(0);
        if (res.body.meta && 'total' in res.body.meta) expect(res.body.meta.total).toBe(0);
        return;
      }

      // 404 / 'hidden': the same answer as an id that does not exist (spec §10.2).
      expect(res.status, body).toBe(404);
      if (expected === 404) {
        const denied = await deniedEntries(outsider, since);
        expect(denied.length, `${label}: no access.denied entry`).toBeGreaterThanOrEqual(1);
        const words = await ownerWords(c);
        for (const entry of denied) expectIdsOnly(entry, words, label);
        if (!isWrite) {
          // Denials are never debounced: a second attempt is audited again.
          const again = await send(row, asOutsider);
          expect(again.status).toBe(404);
          expect((await deniedEntries(outsider, since)).length, `${label}: debounced`).toBe(
            denied.length * 2,
          );
        }
      }
      if (before) {
        expect(await snapshot(), `${label}: an outsider's write changed data`).toEqual(before);
      }
      const missing = await send(row, { ...missingIds(c), me: outsider });
      expect(missing.status, JSON.stringify(missing.body)).toBe(404);
      expect(errorShape(res.body), `${label}: tells an outsider apart from a missing id`).toEqual(
        errorShape(missing.body),
      );
    });
  }
});

describe('lab technicians reach a patient only through a placed lab order (D120)', () => {
  /** A patient with a draft (never placed) lab order and a lab report document. */
  async function unplacedSetup() {
    const doctor = await createDoctor();
    const { id: patientId } = await createPatient();
    const test = await createLabTest();
    const draft = await insertLabOrder({
      patient: patientId,
      doctor: doctor.id,
      status: 'draft',
      tests: [{ _id: test._id, code: test.code, name: test.name, pricePaise: 100 }],
    });
    const stored = await getStorage().save(MATRIX_PDF, {
      mimeType: 'application/pdf',
      originalName: 'r.pdf',
    });
    const doc = await DocumentModel.create({
      patient: patientId,
      category: 'lab_report',
      title: 'Lab report',
      originalName: 'r.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MATRIX_PDF.length,
      storageDriver: 'local',
      storageKey: stored.storageKey,
      checksumSha256: 'c'.repeat(64),
      visibleToPatient: true,
    });
    return { patientId, draftId: draft._id.toString(), documentId: doc._id.toString() };
  }

  const missing = () => new Types.ObjectId().toString();

  it.each([
    ['GET /lab-orders/:id', (s: Setup) => api().get(`/api/v1/lab-orders/${s.draftId}`)],
    [
      'GET /documents?patient=',
      (s: Setup) => api().get(`/api/v1/documents?patient=${s.patientId}`),
    ],
    ['GET /documents/:id', (s: Setup) => api().get(`/api/v1/documents/${s.documentId}`)],
    [
      'GET /documents/:id/download',
      (s: Setup) => api().get(`/api/v1/documents/${s.documentId}/download`),
    ],
    [
      'POST /documents',
      (s: Setup) =>
        api()
          .post('/api/v1/documents')
          .field('patientId', s.patientId)
          .field('category', 'lab_report')
          .field('title', 'Upload')
          .attach('file', MATRIX_PDF, { filename: 'u.pdf', contentType: 'application/pdf' }),
    ],
  ] as const)('%s → 404 like a missing id, audited', async (label, call) => {
    count('lab technician without a placed order');
    const s = await unplacedSetup();
    const lab = await loginAs('labtech');
    const before = await snapshot();
    const since = new Date();
    const res = await call(s).set(lab.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await snapshot()).toEqual(before);
    const ghost = { patientId: missing(), draftId: missing(), documentId: missing() };
    const gone = await call(ghost).set(lab.auth);
    expect(errorShape(res.body), label).toEqual(errorShape(gone.body));
    const denied = await deniedEntries(lab, since);
    expect(denied.length, `${label}: no access.denied entry`).toBeGreaterThanOrEqual(1);
    const p = await Patient.findById(s.patientId).lean();
    for (const entry of denied) expectIdsOnly(entry, [p!.lastName, p!.mrn, p!.phone], label);
  });

  it('the worklist and patient lists leave out the unplaced order and its patient', async () => {
    count('lab technician without a placed order');
    const s = await unplacedSetup();
    const lab = await loginAs('labtech');
    const res = await api().get('/api/v1/lab-orders').set(lab.auth);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(s.draftId);
    expect(JSON.stringify(res.body)).not.toContain(s.patientId);
  });

  it('with a placed order the lab sees the minimal patient view only (§2.5)', async () => {
    count('lab technician without a placed order');
    const doctor = await createDoctor();
    const { id: patientId } = await createPatient(FULL_PATIENT);
    const order = await insertLabOrder({ patient: patientId, doctor: doctor.id });
    const lab = await loginAs('labtech');
    const res = await api().get(`/api/v1/lab-orders/${order._id}`).set(lab.auth);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.patient).sort()).toEqual(
      ['age', 'allergies', 'fullName', 'gender', 'id', 'mrn'].sort(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(
      /priya@example\.com|MG Road|Star Health|Hypertension|Prefers morning/,
    );
    expect((await api().get(`/api/v1/patients/${patientId}`).set(lab.auth)).status).toBe(403);
  });
});

type Setup = { patientId: string; draftId: string; documentId: string };

/** A patient with every §2.5 field set. */
const FULL_PATIENT = {
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya@example.com',
  address: { line1: '12 MG Road', city: 'Bengaluru' },
  insurance: { provider: 'Star Health', policyNumber: 'SH-1' },
  adminNotes: 'Prefers morning slots',
  allergies: [{ substance: 'Penicillin', severity: 'severe', recordedAt: new Date() }],
  chronicConditions: [{ name: 'Hypertension', recordedAt: new Date() }],
};

/** §2.5 rows → the fields of GET /patients/:id that carry them. */
const FIELD_GROUPS = {
  core: ['fullName', 'mrn', 'age', 'gender'],
  contact: ['phone', 'email', 'address'],
  allergies: ['allergies'],
  chronicConditions: ['chronicConditions'],
  insurance: ['insurance'],
  adminNotes: ['adminNotes'],
} as const;
type Group = keyof typeof FIELD_GROUPS;

/** Spec §2.5 (with D60): which field groups each caller sees on GET /patients/:id. */
const VISIBLE: Record<string, Group[]> = {
  admin: ['core', 'contact', 'insurance', 'adminNotes'],
  'doctor (rel)': ['core', 'contact', 'allergies', 'chronicConditions'],
  receptionist: ['core', 'contact', 'allergies', 'insurance', 'adminNotes'],
  'patient (own)': ['core', 'contact', 'allergies', 'chronicConditions', 'insurance'],
};

describe('field-level visibility on GET /patients/:id (spec §2.5)', () => {
  /** The full patient and a logged-in caller for each column of §2.5. */
  async function caller(who: string): Promise<{ me: LoggedIn | null; patientId: string }> {
    if (who === 'patient (own)') {
      const me = await loginAsPatient(FULL_PATIENT);
      return { me, patientId: me.patientId };
    }
    const { id: patientId } = await createPatient(FULL_PATIENT);
    if (who === 'anonymous') return { me: null, patientId };
    if (who === 'doctor (rel)' || who === 'doctor (no rel)') {
      const me = await loginAsDoctor();
      if (who === 'doctor (rel)') {
        await insertAppointment({
          patient: patientId,
          doctor: me.id,
          startAt: new Date(Date.now() + 86_400_000),
        });
      }
      return { me, patientId };
    }
    if (who === 'patient B') return { me: await loginAsPatient(), patientId };
    return { me: await loginAs(who as Role), patientId };
  }

  it.each(Object.entries(VISIBLE))('%s sees exactly its §2.5 fields', async (who, groups) => {
    count('field visibility');
    const { me, patientId } = await caller(who);
    const res = await api().get(`/api/v1/patients/${patientId}`).set(me!.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const [group, fields] of Object.entries(FIELD_GROUPS) as [Group, readonly string[]][]) {
      for (const field of fields) {
        if (groups.includes(group))
          expect(res.body.data, `${who} misses ${field}`).toHaveProperty(field);
        else expect(res.body.data, `${who} sees ${field}`).not.toHaveProperty(field);
      }
    }
    const json = JSON.stringify(res.body);
    const values: Record<Group, string | null> = {
      core: null,
      contact: 'priya@example.com',
      allergies: 'Penicillin',
      chronicConditions: 'Hypertension',
      insurance: 'Star Health',
      adminNotes: 'Prefers morning slots',
    };
    for (const [group, value] of Object.entries(values) as [Group, string | null][]) {
      if (value === null) continue;
      if (groups.includes(group)) expect(json).toContain(value);
      else expect(json, `${who} gets ${group} in the body`).not.toContain(value);
    }
  });

  it.each([
    ['doctor (no rel)', 404],
    ['patient B', 404],
    ['labtech', 403],
    ['anonymous', 401],
  ] as const)('%s → %i and no field at all', async (who, status) => {
    count('field visibility');
    const { me, patientId } = await caller(who);
    let req = api().get(`/api/v1/patients/${patientId}`);
    if (me) req = req.set(me.auth);
    const res = await req;
    expect(res.status).toBe(status);
    expect(JSON.stringify(res.body)).not.toMatch(
      /Sharma|priya@|Penicillin|Hypertension|Star Health/,
    );
  });
});
