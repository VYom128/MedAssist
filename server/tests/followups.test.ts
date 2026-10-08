import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Document as DocumentModel } from '../src/modules/documents/model.js';
import { FollowupRequest } from '../src/modules/followups/model.js';
import { User } from '../src/modules/users/model.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { addDaysToDate, clinicToday } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  at,
  createDoctor,
  createPatient,
  createSchedule,
  createService,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  nextWeekday,
  TEST_TZ,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Follow-up requests (spec §4.10, §5.6, §6.18, §7.13, Phase 8): limits, the status machine incl.
 * a patient reply reopening, internal staff notes never reaching the patient, scheduling through
 * the booking service in one transaction, reassignment and the care relationship it creates,
 * notifications and socket events without message text.
 */

const SYMPTOM = 'My chest pain got worse after the new tablets';
const NOTE = 'Internal: discussed with Dr Rao, likely gastritis';

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), FollowupRequest.init()]);
  emails = captureEmails();
});
afterEach(() => emails.restore());

interface Setup {
  doctor: LoggedIn & { id: string };
  patient: LoggedIn & { patientId: string };
  reception: LoggedIn;
  serviceId: string;
  visitId: string;
}

/** A doctor working all day, a service, a patient with a completed visit with them, reception. */
async function setup(): Promise<Setup> {
  const doctor = await loginAsDoctor();
  await createSchedule(doctor.id, [{ start: '00:00', end: '23:55' }]);
  const service = await createService();
  const patient = await loginAsPatient();
  const reception = await loginAs('receptionist');
  const visit = await insertAppointment({
    patient: patient.patientId,
    doctor: doctor.id,
    startAt: new Date(Date.now() - 5 * 86_400_000),
    status: 'completed',
    isSlotActive: false,
  });
  return {
    doctor,
    patient,
    reception,
    serviceId: service._id.toString(),
    visitId: visit._id.toString(),
  };
}

const send = (who: LoggedIn, method: 'get' | 'post', path: string, body?: object) => {
  const req = api()[method](`/api/v1${path}`).set(who.auth);
  return body ? req.send(body) : req;
};
const create = (who: LoggedIn, body: object) => send(who, 'post', '/follow-up-requests', body);
const message = (who: LoggedIn, id: string, text: string, visibility?: 'all' | 'staff') =>
  send(who, 'post', `/follow-up-requests/${id}/messages`, {
    text,
    ...(visibility ? { visibility } : {}),
  });

async function openRequest(s: Setup, body: object = {}) {
  const res = await create(s.patient, {
    relatedAppointmentId: s.visitId,
    type: 'new_or_worse_symptoms',
    message: SYMPTOM,
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; requestNumber: string; status: string };
}

describe('POST /follow-up-requests', () => {
  it('creates an open request assigned to the visit’s doctor, without text in audits or emails', async () => {
    const s = await setup();
    const emitted: { event: string; rooms: string[]; payload: unknown }[] = [];
    setSocketServer({
      to: (rooms: string | string[]) => ({
        emit: (event: string, payload: unknown) =>
          emitted.push({ event, rooms: ([] as string[]).concat(rooms), payload }),
      }),
    } as never);
    try {
      const year = clinicToday(TEST_TZ).slice(0, 4);
      const r = await openRequest(s, { preferredDate: addDaysToDate(clinicToday(TEST_TZ), 3) });
      expect(r).toMatchObject({
        requestNumber: `FUR-${year}-000001`,
        status: 'open',
        type: 'new_or_worse_symptoms',
        message: SYMPTOM,
        assignedDoctor: { id: s.doctor.id },
        relatedAppointmentId: s.visitId,
        messages: [],
      });
      const [entry] = await auditEntries('followup.create');
      expect(entry).toBeDefined();
      expect(JSON.stringify(entry)).not.toContain('chest');

      // The doctor and every receptionist are emailed – no text, no type.
      await vi.waitFor(() => expect(emails.sent.length).toBeGreaterThanOrEqual(2));
      expect(emails.sent.map((m) => m.to).sort()).toEqual(
        [s.doctor.user.email, s.reception.user.email].sort(),
      );
      expect(JSON.stringify(emails.sent)).not.toMatch(/chest|symptom/i);
      // Each role's email opens its own page.
      const toDoctor = emails.sent.find((m) => m.to === s.doctor.user.email);
      const toDesk = emails.sent.find((m) => m.to === s.reception.user.email);
      expect(JSON.stringify(toDoctor)).toContain(`/doctor/follow-ups/${r.id}`);
      expect(JSON.stringify(toDesk)).toContain(`/reception/follow-ups/${r.id}`);
      // followup.updated with the id only, to the doctor, the patient and reception's room.
      const event = emitted.find((e) => e.event === 'followup.updated');
      expect(event?.payload).toEqual({ requestId: r.id });
      expect(event?.rooms).toEqual(
        expect.arrayContaining([
          `user:${s.doctor.id}`,
          `user:${s.patient.user._id.toString()}`,
          'role:receptionist',
        ]),
      );
    } finally {
      setSocketServer(null);
    }
  });

  it('without a related visit the request is unassigned (reception triage)', async () => {
    const s = await setup();
    const res = await create(s.patient, { type: 'question', message: 'Can I take it with milk?' });
    expect(res.status).toBe(201);
    expect(res.body.data.assignedDoctor).toBeNull();
  });

  it('refuses someone else’s visit or documents (422) and links own attachments', async () => {
    const s = await setup();
    const other = await createPatient();
    const theirVisit = await insertAppointment({
      patient: other.id,
      doctor: s.doctor.id,
      startAt: new Date(Date.now() - 86_400_000),
      status: 'completed',
      isSlotActive: false,
    });
    const notMine = await create(s.patient, {
      relatedAppointmentId: theirVisit._id.toString(),
      type: 'question',
      message: 'x',
    });
    expect(notMine.status).toBe(422);
    expectErrorShape(notMine.body, 'BUSINESS_RULE_VIOLATION');

    const doc = {
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageDriver: 'local',
      storageKey: 'unused',
      checksumSha256: 'd'.repeat(64),
      originalName: 'x.pdf',
      category: 'other',
      title: 'Photo of the rash',
      visibleToPatient: true,
      uploadedByRole: 'patient',
    };
    const [mine, theirs] = await DocumentModel.create([
      { ...doc, patient: s.patient.patientId, uploadedBy: s.patient.user._id },
      { ...doc, patient: other.id },
    ]);
    const bad = await create(s.patient, {
      type: 'question',
      message: 'See attached',
      attachmentIds: [theirs!._id.toString()],
    });
    expect(bad.status).toBe(422);
    const ok = await create(s.patient, {
      type: 'question',
      message: 'See attached',
      attachmentIds: [mine!._id.toString()],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.attachments).toEqual([
      expect.objectContaining({ id: mine!._id.toString(), title: 'Photo of the rash' }),
    ]);
    const linked = await DocumentModel.findById(mine!._id).lean();
    expect(linked?.linked).toMatchObject({ type: 'followup_request' });
    expect(linked?.linked?.id?.toString()).toBe(ok.body.data.id);
  });

  it('allows at most 3 open requests and 5 new ones per day (422 FOLLOWUP_LIMIT_REACHED)', async () => {
    const s = await setup();
    const first = await openRequest(s);
    await openRequest(s);
    await openRequest(s);
    const fourth = await create(s.patient, { type: 'question', message: 'One more' });
    expect(fourth.status).toBe(422);
    expectErrorShape(fourth.body, 'FOLLOWUP_LIMIT_REACHED');
    expect(fourth.body.error.details).toMatchObject({ kind: 'open', limit: 3 });

    // Closing one frees a place; a sixth request the same day is refused.
    const close = (id: string) =>
      send(s.patient, 'post', `/follow-up-requests/${id}/close`, { reason: 'Feeling better' });
    expect((await close(first.id)).status).toBe(200);
    const fourthAgain = await openRequest(s);
    await close(fourthAgain.id);
    const fifth = await openRequest(s);
    await close(fifth.id);
    const sixth = await create(s.patient, { type: 'question', message: 'Again' });
    expect(sixth.status).toBe(422);
    expect(sixth.body.error.details).toMatchObject({ kind: 'daily', limit: 5 });
  });

  it('parallel requests cannot pass the open limit together', async () => {
    const s = await setup();
    await openRequest(s);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => create(s.patient, { type: 'question', message: 'Race' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 422)).toHaveLength(2);
  });

  it('is for linked patients only', async () => {
    const s = await setup();
    expect((await create(s.reception, { type: 'question', message: 'x' })).status).toBe(403);
    const { id } = await createPatient();
    const pending = await loginAs('patient', {
      patient: id,
      patientLinkStatus: 'pending_verification',
    });
    const res = await create(pending, { type: 'question', message: 'x' });
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'PATIENT_LINK_PENDING');
  });
});

describe('reading follow-up requests', () => {
  it('reception and admins see all, doctors their assigned ones, patients their own', async () => {
    const s = await setup();
    const mine = await openRequest(s);
    const other = await loginAsPatient();
    const theirs = await create(other, { type: 'refill_request', message: 'Refill please' });
    const admin = await loginAs('admin');

    const ids = async (who: LoggedIn, query = '') =>
      (await send(who, 'get', `/follow-up-requests${query}`)).body.data.map(
        (r: { id: string }) => r.id,
      );
    expect((await ids(s.reception)).sort()).toEqual([mine.id, theirs.body.data.id].sort());
    expect((await ids(admin)).sort()).toEqual([mine.id, theirs.body.data.id].sort());
    expect(await ids(s.doctor)).toEqual([mine.id]);
    expect(await ids(s.patient)).toEqual([mine.id]);
    expect(await ids(s.reception, '?type=refill_request')).toEqual([theirs.body.data.id]);
    expect(await ids(s.reception, `?q=${mine.requestNumber}`)).toEqual([mine.id]);
    expect(await ids(s.reception, `?assignedDoctor=${s.doctor.id}`)).toEqual([mine.id]);
    // List rows carry no text.
    const list = await send(s.reception, 'get', '/follow-up-requests');
    expect(JSON.stringify(list.body)).not.toContain('chest');

    // Others' requests are 404 (audited); lab technicians have no access at all.
    const stranger = await loginAsDoctor();
    expect((await send(stranger, 'get', `/follow-up-requests/${mine.id}`)).status).toBe(404);
    expect((await send(other, 'get', `/follow-up-requests/${mine.id}`)).status).toBe(404);
    const lab = await loginAs('labtech');
    expect((await send(lab, 'get', '/follow-up-requests')).status).toBe(403);
    expect((await auditEntries('access.denied')).length).toBeGreaterThanOrEqual(2);

    const detail = await send(s.doctor, 'get', `/follow-up-requests/${mine.id}`);
    expect(detail.status).toBe(200);
    expect(await auditEntries('followup.view')).toHaveLength(1);
  });
});

describe('messages and status changes', () => {
  it('staff reply → responded; patient reply → open again; internal notes change nothing', async () => {
    const s = await setup();
    const r = await openRequest(s);

    const note = await message(s.reception, r.id, NOTE, 'staff');
    expect(note.status).toBe(201);
    expect(note.body.data.status).toBe('open');

    const reply = await message(s.doctor, r.id, 'Please stop the new tablet and come in.');
    expect(reply.body.data.status).toBe('responded');
    const back = await message(s.patient, r.id, 'Thank you, I will.');
    expect(back.status).toBe(201);
    expect(back.body.data.status).toBe('open');
    expect(back.body.data.messages).toHaveLength(2);

    const audit = await auditEntries('followup.message');
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toMatch(/gastritis|tablet/);
  });

  it('internal staff notes never reach the patient (detail, list, timeline, emails)', async () => {
    const s = await setup();
    const r = await openRequest(s);
    emails.sent.length = 0;
    await message(s.reception, r.id, NOTE, 'staff');
    await message(s.reception, r.id, 'We will call you today.');

    const detail = await send(s.patient, 'get', `/follow-up-requests/${r.id}`);
    expect(detail.body.data.messages.map((m: { text: string }) => m.text)).toEqual([
      'We will call you today.',
    ]);
    expect(detail.body.data.messageCount).toBe(1);
    expect(detail.body.data.statusHistory[0]).not.toHaveProperty('by');
    const list = await send(s.patient, 'get', '/follow-up-requests');
    expect(list.body.data[0].messageCount).toBe(1);
    const timeline = await send(s.patient, 'get', '/patients/me/timeline?types=followup_request');
    expect(timeline.body.data).toEqual([
      expect.objectContaining({ type: 'followup_request', id: r.id, status: 'responded' }),
    ]);
    expect(JSON.stringify([detail.body, list.body, timeline.body])).not.toContain('gastritis');
    // Staff see both; the patient's email says "please log in" without the reply.
    const staff = await send(s.reception, 'get', `/follow-up-requests/${r.id}`);
    expect(staff.body.data.messages).toHaveLength(2);
    await vi.waitFor(() => expect(emails.sent.length).toBe(1));
    expect(emails.sent[0]!.to).toBe(s.patient.user.email);
    expect(JSON.stringify(emails.sent)).not.toMatch(/gastritis|call you/);
    expect(JSON.stringify(emails.sent)).toMatch(/log in/i);
  });

  it('patients cannot post internal notes, reject, or reply once it is finished', async () => {
    const s = await setup();
    const r = await openRequest(s);
    const internal = await message(s.patient, r.id, 'Hidden?', 'staff');
    expect(internal.status).toBe(422);
    const reject = await send(s.patient, 'post', `/follow-up-requests/${r.id}/reject`, {
      reason: 'Not needed',
    });
    expect(reject.status).toBe(403);
    const close = await send(s.patient, 'post', `/follow-up-requests/${r.id}/close`, {
      reason: 'Feeling better now',
    });
    expect(close.status).toBe(200);
    expect(close.body.data).toMatchObject({ status: 'closed', closedReason: 'Feeling better now' });
    const late = await message(s.patient, r.id, 'Actually, one more thing');
    expect(late.status).toBe(409);
    expectErrorShape(late.body, 'INVALID_STATUS_TRANSITION');
  });

  it('review: open → in_review once (409 after); reject with a reason; unrelated doctors 404', async () => {
    const s = await setup();
    const r = await openRequest(s);
    const review = await send(s.doctor, 'post', `/follow-up-requests/${r.id}/review`);
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('in_review');
    const again = await send(s.reception, 'post', `/follow-up-requests/${r.id}/review`);
    expect(again.status).toBe(409);
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');

    const stranger = await loginAsDoctor();
    expect((await send(stranger, 'post', `/follow-up-requests/${r.id}/review`)).status).toBe(404);
    expect((await message(stranger, r.id, 'Hello')).status).toBe(404);

    const noReason = await send(s.reception, 'post', `/follow-up-requests/${r.id}/reject`, {});
    expect(noReason.status).toBe(400);
    const rejected = await send(s.reception, 'post', `/follow-up-requests/${r.id}/reject`, {
      reason: 'Please book a normal appointment',
    });
    expect(rejected.body.data).toMatchObject({ status: 'rejected' });
    expect(rejected.body.data.statusHistory.at(-1)).toMatchObject({ status: 'rejected' });
    expect(await auditEntries('followup.reject')).toHaveLength(1);
    const closeAfter = await send(s.reception, 'post', `/follow-up-requests/${r.id}/close`, {
      reason: 'Closing it anyway',
    });
    expect(closeAfter.status).toBe(409);
  });
});

describe('POST /follow-up-requests/:id/assign', () => {
  it('reassigns to an active doctor, who then has a care relationship with the patient', async () => {
    const s = await setup();
    const r = await openRequest(s);
    const other = await loginAsDoctor();
    expect((await send(other, 'get', `/patients/${s.patient.patientId}`)).status).toBe(404);

    const res = await send(s.reception, 'post', `/follow-up-requests/${r.id}/assign`, {
      doctorId: other.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.assignedDoctor.id).toBe(other.id);
    expect((await send(other, 'get', `/follow-up-requests/${r.id}`)).status).toBe(200);
    expect((await send(s.doctor, 'get', `/follow-up-requests/${r.id}`)).status).toBe(404);
    expect((await send(other, 'get', `/patients/${s.patient.patientId}`)).status).toBe(200);
    const [entry] = await auditEntries('followup.assign');
    expect(entry?.changes).toMatchObject({ fields: ['assignedDoctor'] });

    // Inactive doctors and non-doctors are refused; doctors cannot reassign.
    const inactive = await createDoctor({ isActive: false });
    const bad = await send(s.reception, 'post', `/follow-up-requests/${r.id}/assign`, {
      doctorId: inactive.id,
    });
    expect(bad.status).toBe(422);
    const notDoctor = await send(s.reception, 'post', `/follow-up-requests/${r.id}/assign`, {
      doctorId: s.patient.user._id.toString(),
    });
    expect(notDoctor.status).toBe(422);
    const byDoctor = await send(other, 'post', `/follow-up-requests/${r.id}/assign`, {
      doctorId: s.doctor.id,
    });
    expect(byDoctor.status).toBe(403);
  });
});

describe('POST /follow-up-requests/:id/schedule', () => {
  // A Tuesday at least 3 days ahead (+1 = Wednesday): always a clinic working day.
  const slot = (days: number, time: string) =>
    at(addDaysToDate(nextWeekday(2, 3), days - 3), time).toISOString();

  it('books a follow-up appointment and marks the request scheduled in one go', async () => {
    const s = await setup();
    const r = await openRequest(s);
    const res = await send(s.reception, 'post', `/follow-up-requests/${r.id}/schedule`, {
      startAt: slot(3, '10:00'),
      serviceId: s.serviceId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.request).toMatchObject({
      status: 'scheduled',
      resultingAppointmentId: res.body.data.appointment.id,
    });
    const appt = await Appointment.findById(res.body.data.appointment.id).lean();
    expect(appt).toMatchObject({ type: 'follow_up', status: 'scheduled' });
    expect(appt?.followUpOf?.toString()).toBe(s.visitId);
    expect(appt?.doctor.toString()).toBe(s.doctor.id);
    expect(await auditEntries('followup.schedule')).toHaveLength(1);
    expect(await auditEntries('appointment.create')).toHaveLength(1);

    // Twice → 409, and no second appointment.
    const again = await send(s.reception, 'post', `/follow-up-requests/${r.id}/schedule`, {
      startAt: slot(4, '10:00'),
      serviceId: s.serviceId,
    });
    expect(again.status).toBe(409);
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');
    expect(await Appointment.countDocuments({ type: 'follow_up' })).toBe(1);
  });

  it('a booking conflict (409) leaves the request unchanged', async () => {
    const s = await setup();
    const r = await openRequest(s);
    const other = await createPatient();
    await insertAppointment({
      patient: other.id,
      doctor: s.doctor.id,
      startAt: new Date(slot(3, '10:00')),
    });
    const res = await send(s.reception, 'post', `/follow-up-requests/${r.id}/schedule`, {
      startAt: slot(3, '10:00'),
      serviceId: s.serviceId,
    });
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'SLOT_UNAVAILABLE');
    const fresh = await FollowupRequest.findById(r.id).lean();
    expect(fresh).toMatchObject({ status: 'open' });
    expect(fresh?.resultingAppointment).toBeUndefined();
    expect(
      await Appointment.countDocuments({ patient: s.patient.patientId, status: 'scheduled' }),
    ).toBe(0);
  });

  it('the assigned doctor schedules with themselves only; unassigned requests need a doctor', async () => {
    const s = await setup();
    const r = await openRequest(s);
    const other = await createDoctor();
    const elsewhere = await send(s.doctor, 'post', `/follow-up-requests/${r.id}/schedule`, {
      startAt: slot(3, '11:00'),
      serviceId: s.serviceId,
      doctorId: other.id,
    });
    expect(elsewhere.status).toBe(403);
    const own = await send(s.doctor, 'post', `/follow-up-requests/${r.id}/schedule`, {
      startAt: slot(3, '11:00'),
      serviceId: s.serviceId,
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.data.appointment.source).toBe('doctor');

    const unassigned = await create(s.patient, { type: 'question', message: 'Another one' });
    const noDoctor = await send(
      s.reception,
      'post',
      `/follow-up-requests/${unassigned.body.data.id}/schedule`,
      { startAt: slot(3, '12:00'), serviceId: s.serviceId },
    );
    expect(noDoctor.status).toBe(422);
    expect(noDoctor.body.error.details).toEqual([
      expect.objectContaining({ field: 'body.doctorId' }),
    ]);
  });
});

describe('patient users', () => {
  it('a request id that does not exist is 404 for everyone', async () => {
    const s = await setup();
    const id = new Types.ObjectId().toString();
    for (const who of [s.reception, s.doctor, s.patient]) {
      expect((await send(who, 'get', `/follow-up-requests/${id}`)).status).toBe(404);
    }
    expect(await User.countDocuments({ role: 'patient' })).toBeGreaterThan(0);
  });
});
