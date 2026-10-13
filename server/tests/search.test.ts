import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { logger } from '../src/utils/logger.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import {
  createPatient,
  insertAppointment,
  insertLabOrder,
  loginAsDoctor,
  loginAsPatient,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Global search (spec §12.1, Phase 10): role-scoped groups, at most 5 each, exact matches before
 * prefixes, minimal fields, the caller's own pages as links – and the query text never logged.
 */

beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Invoice.init(), LabOrder.init()]);
});

const search = (who: LoggedIn, q: string) =>
  api()
    .get(`/api/v1/search?q=${encodeURIComponent(q)}`)
    .set(who.auth);

let inv = 0;
async function invoice(patient: string, status = 'issued') {
  inv += 1;
  return Invoice.collection.insertOne({
    invoiceNumber: status === 'draft' ? undefined : `INV-2026-${String(inv).padStart(6, '0')}`,
    patient: new Types.ObjectId(patient),
    status,
    items: [],
    issuedAt: status === 'draft' ? undefined : new Date(),
    createdAt: new Date(),
  } as never);
}

/** Two patients, the first with appointments, an invoice and a lab order with a doctor. */
async function data() {
  const doctor = await loginAsDoctor();
  const stranger = await loginAsDoctor();
  const priya = await createPatient({ firstName: 'Priya', lastName: 'Sharma' });
  const prakash = await createPatient({ firstName: 'Prakash', lastName: 'Verma' });
  const appts = [];
  for (let i = 0; i < 7; i += 1) {
    appts.push(
      await insertAppointment({
        patient: priya.id,
        doctor: doctor.id,
        startAt: new Date(Date.now() + (i + 1) * 86_400_000),
      }),
    );
  }
  await invoice(priya.id);
  await invoice(priya.id, 'draft');
  const order = await insertLabOrder({
    patient: priya.id,
    doctor: doctor.id,
    sample: { sampleId: 'S26-000042' },
  });
  return { doctor, stranger, priya, prakash, appts, order };
}

describe('GET /search', () => {
  it('400 when the query is shorter than 2 characters', async () => {
    const me = await loginAs('receptionist');
    const res = await search(me, ' a ');
    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'VALIDATION_ERROR');
  });

  it('reception: patients, appointments, invoices and lab orders – 5 per group, exact first', async () => {
    const d = await data();
    const me = await loginAs('receptionist');

    const byName = await search(me, 'pr');
    expect(byName.status).toBe(200);
    expect(byName.body.data.groups).toEqual(['patients', 'appointments', 'invoices', 'labOrders']);
    expect(byName.body.data.patients.map((p: { name: string }) => p.name)).toEqual([
      'Priya Sharma',
      'Prakash Verma',
    ]);
    expect(byName.body.data.patients[0]).toEqual({
      id: d.priya.id,
      mrn: d.priya.patient.mrn,
      name: 'Priya Sharma',
      link: `/reception/patients/${d.priya.id}`,
    });

    const byMrn = await search(me, d.prakash.patient.mrn!);
    expect(byMrn.body.data.patients.map((p: { id: string }) => p.id)).toEqual([d.prakash.id]);

    // An exact appointment number comes first, then prefix matches, at most 5.
    const exact = d.appts[6]!.appointmentNumber;
    const byNumber = await search(me, exact.toLowerCase());
    expect(byNumber.body.data.appointments[0]).toMatchObject({
      number: exact,
      patientName: 'Priya Sharma',
      link: `/reception/appointments/${d.appts[6]!._id.toString()}`,
    });
    const prefix = await search(me, 'APT-1999');
    expect(prefix.body.data.appointments).toHaveLength(5);

    const labs = await search(me, 'S26-000042');
    expect(labs.body.data.labOrders).toEqual([
      expect.objectContaining({ id: d.order._id.toString(), sampleId: 'S26-000042' }),
    ]);
    const invoices = await search(me, 'INV-2026');
    expect(invoices.body.data.invoices).toHaveLength(1); // drafts have no number
    expect(JSON.stringify(invoices.body.data)).not.toMatch(/Paise|amount|total/i);
  });

  it('admins get no lab orders group', async () => {
    await data();
    const me = await loginAs('admin');
    const res = await search(me, 'LAB-1999');
    expect(res.body.data.groups).toEqual(['patients', 'appointments', 'invoices']);
    expect(res.body.data).not.toHaveProperty('labOrders');
  });

  it('doctors find only patients they have a care relationship with, and their own records', async () => {
    const d = await data();
    const mine = await search(d.doctor, 'Priya');
    expect(mine.body.data.groups).toEqual(['patients', 'appointments', 'labOrders']);
    expect(mine.body.data.patients.map((p: { id: string }) => p.id)).toEqual([d.priya.id]);
    expect(mine.body.data.patients[0].link).toBe(`/doctor/patients/${d.priya.id}`);
    expect((await search(d.doctor, 'Prakash')).body.data.patients).toEqual([]);

    const theirs = await search(d.stranger, 'Priya');
    expect(theirs.body.data.patients).toEqual([]);
    expect((await search(d.stranger, 'APT-1999')).body.data.appointments).toEqual([]);
    expect((await search(d.stranger, 'S26-000042')).body.data.labOrders).toEqual([]);
    expect((await search(d.doctor, 'S26-000042')).body.data.labOrders).toHaveLength(1);
  });

  it('patients find only their own records, without a patients group', async () => {
    const d = await data();
    const priya = await loginAsPatient({ firstName: 'Priya', lastName: 'Two' });
    await insertAppointment({
      patient: priya.patientId,
      doctor: d.doctor.id,
      startAt: new Date(Date.now() + 9 * 86_400_000),
    });
    await invoice(priya.patientId);
    const res = await search(priya, 'APT-1999');
    expect(res.body.data.groups).toEqual(['appointments', 'invoices', 'labOrders']);
    expect(res.body.data.appointments).toHaveLength(1);
    expect(res.body.data.appointments[0]).toMatchObject({
      patientName: null,
      link: '/patient/appointments',
    });
    expect((await search(priya, 'INV-2026')).body.data.invoices).toHaveLength(1);
    // Lab orders: released only, own only.
    expect((await search(priya, 'S26-000042')).body.data.labOrders).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('Sharma');
  });

  it('lab techs get lab orders with minimal patient data only', async () => {
    const d = await data();
    const me = await loginAs('labtech');
    const res = await search(me, 'Sharma');
    expect(res.body.data.groups).toEqual(['labOrders']);
    expect(res.body.data.labOrders).toEqual([
      {
        id: d.order._id.toString(),
        number: d.order.orderNumber,
        sampleId: 'S26-000042',
        status: 'ordered',
        orderedAt: expect.any(String),
        patientName: 'Priya Sharma',
        patientMrn: d.priya.patient.mrn,
        link: `/lab/orders/${d.order._id.toString()}`,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/phone|dateOfBirth|\+91/);
  });

  it('logs the query length only, never the text', async () => {
    const debug = vi.spyOn(logger, 'debug');
    const me = await loginAs('receptionist');
    await search(me, 'Secretname');
    expect(debug).toHaveBeenCalledWith(
      { search: { length: 10, role: 'receptionist' } },
      'Global search',
    );
    expect(JSON.stringify(debug.mock.calls)).not.toContain('Secretname');
    debug.mockRestore();
  });
});
