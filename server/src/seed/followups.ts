import { Types } from 'mongoose';
import { ROLES } from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import { getSlots } from '../modules/appointments/slots.service.js';
import { DoctorProfile } from '../modules/doctors/model.js';
import { Document } from '../modules/documents/model.js';
import { NoteAmendment } from '../modules/encounters/amendment.model.js';
import { amendEncounter } from '../modules/encounters/amendment.service.js';
import { NOT_BOOKED_STATUSES } from '../modules/encounters/followUp.js';
import { Encounter } from '../modules/encounters/model.js';
import { amendEncounterSchema } from '../modules/encounters/validation.js';
import { FollowupReminder } from '../modules/followupReminders/model.js';
import { syncFollowUpReminder } from '../modules/followupReminders/service.js';
import { FollowupRequest } from '../modules/followups/model.js';
import { scheduleFollowup } from '../modules/followups/schedule.service.js';
import {
  assignFollowup,
  createFollowup,
  finishFollowup,
  postMessage,
  reviewFollowup,
} from '../modules/followups/service.js';
import { createFollowupSchema } from '../modules/followups/validation.js';
import { Service } from '../modules/services/model.js';
import { getSettings } from '../modules/settings/service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { addDaysToDate, clinicToday, daysBetween, toClinicDate } from '../utils/dates.js';
import { SEED_REQUEST, seedActor } from './context.js';
import { patientActor } from './documents.js';
import { doctorActor } from './encounters.js';
import { patientLogins, PENDING_SIGNUP_EMAIL } from './patients.js';

/**
 * Follow-ups (Phase 8, spec §15.3), after the notes, documents and invoices:
 * - a follow-up reminder for every signed note with a plan (notes seeded before Phase 8 had none);
 * - planned follow-ups for the reminder job and the portal: three notes amended (through the
 *   amendment service, with a reason) to a follow-up due in two days – patient1's among them –
 *   and one overdue by three days; only notes whose follow-up is not booked yet;
 * - 15 follow-up requests from the portal patients through the real services, in every status
 *   and type: threads with patient messages, staff replies and one internal staff note, two
 *   scheduled into real follow-up appointments (booking service), one rejected, one with
 *   patient1's referral letter attached; back-dated over the last three weeks.
 * Idempotent: each step runs once (the amendments are found by their reason, the requests by
 * existing at all). `--reset` clears requests and reminders.
 */

const DUE_SOON_REASON = 'Follow-up date agreed with the patient by phone';
const OVERDUE_REASON = 'Follow-up interval corrected after the visit';

type Step =
  | { by: 'patient' | 'reception' | 'doctor'; say: string; internal?: boolean }
  | { by: 'reception' | 'doctor'; review: true }
  | { by: 'reception'; assignOther: true }
  | { by: 'reception' | 'doctor'; schedule: true }
  | { by: 'patient' | 'reception' | 'doctor'; close: string }
  | { by: 'reception' | 'doctor'; reject: string };

interface Scenario {
  patient: number; // index into the portal logins (0 = patient1)
  type:
    | 'question'
    | 'new_or_worse_symptoms'
    | 'report_review'
    | 'refill_request'
    | 'reschedule'
    | 'other';
  message: string;
  related: boolean;
  attachReferral?: boolean;
  daysAgo: number;
  steps: Step[];
}

const SCENARIOS: Scenario[] = [
  {
    patient: 0,
    type: 'question',
    message: 'Should I take the tablets before or after breakfast?',
    related: true,
    daysAgo: 18,
    steps: [{ by: 'doctor', say: 'After breakfast, with water. Continue for the full course.' }],
  },
  {
    patient: 0,
    type: 'report_review',
    message:
      'I have attached the referral letter from the heart centre. Could the doctor look at it?',
    related: true,
    attachReferral: true,
    daysAgo: 4,
    steps: [],
  },
  {
    patient: 0,
    type: 'refill_request',
    message: 'My medicines will finish next week. Can I get a refill?',
    related: true,
    daysAgo: 9,
    steps: [
      { by: 'reception', review: true },
      {
        by: 'reception',
        say: 'The doctor would like to see you before renewing. We have booked a visit.',
      },
      { by: 'reception', schedule: true },
    ],
  },
  {
    patient: 1,
    type: 'new_or_worse_symptoms',
    message: 'The cough is worse at night since yesterday.',
    related: true,
    daysAgo: 2,
    steps: [
      { by: 'reception', say: 'Called the patient: no breathlessness, no fever.', internal: true },
      { by: 'doctor', review: true },
    ],
  },
  {
    patient: 1,
    type: 'other',
    message: 'Can I get a fitness certificate for my office?',
    related: false,
    daysAgo: 12,
    steps: [
      { by: 'reception', say: 'Yes – please collect it at the front desk with your ID.' },
      { by: 'patient', close: 'Collected the certificate, thank you' },
    ],
  },
  {
    patient: 2,
    type: 'reschedule',
    message: 'I cannot come on the day of my next visit. Please move it.',
    related: true,
    daysAgo: 15,
    steps: [
      {
        by: 'reception',
        reject: 'Please use Reschedule on the appointment page, or call the clinic',
      },
    ],
  },
  {
    patient: 2,
    type: 'question',
    message: 'Is it fine to travel next week?',
    related: true,
    daysAgo: 6,
    steps: [
      { by: 'doctor', say: 'Yes, carry your medicines and keep drinking water.' },
      { by: 'patient', say: 'Thank you. Can I also go swimming?' },
    ],
  },
  {
    patient: 3,
    type: 'report_review',
    message: 'My blood test report is ready. What does it mean?',
    related: true,
    daysAgo: 8,
    steps: [
      { by: 'doctor', say: 'Your results are within the normal range. No change needed.' },
      { by: 'reception', close: 'Answered by the doctor' },
    ],
  },
  {
    patient: 3,
    type: 'question',
    message: 'Which day is the doctor available next week?',
    related: false,
    daysAgo: 1,
    steps: [],
  },
  {
    patient: 4,
    type: 'refill_request',
    message: 'Please renew my inhaler prescription.',
    related: true,
    daysAgo: 5,
    steps: [{ by: 'reception', review: true }],
  },
  {
    patient: 4,
    type: 'new_or_worse_symptoms',
    message: 'The rash has spread to my arms.',
    related: true,
    daysAgo: 3,
    steps: [
      { by: 'doctor', review: true },
      { by: 'doctor', schedule: true },
    ],
  },
  {
    patient: 5,
    type: 'other',
    message: 'I need a copy of my last bill for insurance.',
    related: false,
    daysAgo: 11,
    steps: [
      { by: 'reception', say: 'You can download it from Invoices in the portal.' },
      { by: 'reception', close: 'Patient can download the invoice' },
    ],
  },
  {
    patient: 6,
    type: 'question',
    message: 'Can I take paracetamol with my other medicines?',
    related: true,
    daysAgo: 7,
    steps: [{ by: 'reception', assignOther: true }],
  },
  {
    patient: 7,
    type: 'reschedule',
    message: 'Can my follow-up be with the same doctor in the evening?',
    related: true,
    daysAgo: 13,
    steps: [{ by: 'doctor', reject: 'Evening sessions are not available for this department' }],
  },
  {
    patient: 7,
    type: 'question',
    message: 'Should I continue the diet chart after the course ends?',
    related: true,
    daysAgo: 20,
    steps: [
      { by: 'doctor', say: 'Yes, continue it until your next visit.' },
      { by: 'patient', close: 'Thank you, that answers my question' },
    ],
  },
];

/** The follow-up service of a doctor's department (else the consultation). */
async function followUpServiceOf(doctorId: Types.ObjectId | string) {
  const profile = await DoctorProfile.findOne({ user: doctorId })
    .populate<{ department: { code: string } }>('department', 'code')
    .lean();
  const code = profile?.department?.code ?? 'GEN';
  const service =
    (await Service.findOne({ code: `FUP-${code}`, isActive: true }).lean()) ??
    (await Service.findOne({ code: `CONS-${code}`, isActive: true }).lean());
  if (!service) throw new Error(`No follow-up service for department ${code}`);
  return service._id.toString();
}

/** Books the request into the doctor's first free slot from 3 days ahead (skipping clashes). */
async function scheduleSoon(
  actor: AuthUser,
  requestId: string,
  doctorId: string,
  today: string,
): Promise<boolean> {
  const serviceId = await followUpServiceOf(doctorId);
  for (let day = 3; day <= 21; day += 1) {
    const date = addDaysToDate(today, day);
    const { slots } = await getSlots(actor, doctorId, { date, serviceId });
    for (const slot of slots.slice(0, 3)) {
      try {
        await scheduleFollowup(
          actor,
          requestId,
          { startAt: slot.startAt, serviceId, doctorId },
          SEED_REQUEST,
        );
        return true;
      } catch (err) {
        // A clash with the patient's other bookings (409/422): try the next slot.
        if (!(err instanceof ApiError) || err.statusCode >= 500) throw err;
      }
    }
  }
  return false;
}

/** 1. A reminder for every signed note with a follow-up plan that has none yet. */
async function backfillReminders(timezone: string) {
  const withReminder = new Set(
    (await FollowupReminder.find().select('encounter').lean()).map((r) => r.encounter.toString()),
  );
  const notes = await Encounter.find({
    status: { $in: ['signed', 'amended'] },
    'followUp.required': true,
  })
    .select('appointment patient doctor visitAt signedAt followUp')
    .lean();
  let created = 0;
  for (const e of notes) {
    if (withReminder.has(e._id.toString())) continue;
    await syncFollowUpReminder(e, { timezone });
    created += 1;
  }
  return created;
}

/**
 * The latest signed (not amended) note of a patient whose follow-up is not booked: no later
 * appointment (not cancelled or missed) with the same doctor.
 */
async function unbookedNoteOf(patientId: string, minDaysAgo = 0, today?: string, tz?: string) {
  const notes = await Encounter.find({ patient: patientId, status: 'signed' })
    .select('appointment doctor visitAt signedAt')
    .sort({ visitAt: -1 })
    .lean();
  for (const e of notes) {
    if (minDaysAgo > 0 && today && tz) {
      const days = daysBetween(toClinicDate(e.signedAt!, tz), today);
      if (days < minDaysAgo || days > 300) continue;
    }
    const later = await Appointment.exists({
      patient: patientId,
      doctor: e.doctor,
      status: { $nin: NOT_BOOKED_STATUSES },
      startAt: { $gt: e.visitAt },
    });
    if (!later) return e;
  }
  return null;
}

/** 2. Follow-ups due in two days (patient1 + two others) and one overdue, by amendment. */
async function plannedFollowUps(portal: { patientId: string }[], today: string, tz: string) {
  const done = { dueSoon: 0, overdue: 0 };
  // Once only (a later run would move the demo dates again).
  if (await NoteAmendment.exists({ reason: { $in: [DUE_SOON_REASON, OVERDUE_REASON] } })) {
    return done;
  }
  const amend = async (
    e: { _id: Types.ObjectId; doctor: Types.ObjectId },
    reason: string,
    followUp: object,
  ) => {
    const input = amendEncounterSchema.body.parse({ reason, changes: { followUp } });
    await amendEncounter(await doctorActor(e.doctor), e._id.toString(), input, SEED_REQUEST);
  };
  for (const p of portal.slice(0, 3)) {
    const e = await unbookedNoteOf(p.patientId);
    if (!e) continue;
    await amend(e, DUE_SOON_REASON, {
      required: true,
      date: addDaysToDate(today, 2),
      instructions: 'Book a review visit',
    });
    done.dueSoon += 1;
  }
  for (const p of portal.slice(3)) {
    const e = await unbookedNoteOf(p.patientId, 4, today, tz);
    if (!e) continue;
    const signedDay = toClinicDate(e.signedAt!, tz);
    await amend(e, OVERDUE_REASON, {
      required: true,
      afterDays: daysBetween(signedDay, addDaysToDate(today, -3)),
      instructions: 'Book a review visit',
    });
    done.overdue += 1;
    break;
  }
  return done;
}

/** 3. The follow-up requests, through the services as the patient and the staff. */
async function requests(portal: (AuthUser & { patientId: string })[], today: string) {
  const done = { requests: 0, scheduled: 0, unchanged: 0 };
  const existing = await FollowupRequest.countDocuments();
  if (existing > 0) {
    done.unchanged = existing;
    return done;
  }
  const reception = await seedActor('reception1@medassist.dev', ROLES.RECEPTIONIST);
  const referral = await Document.findOne({
    patient: portal[0]!.patientId,
    title: 'Referral letter from City Heart Centre',
  })
    .select('_id')
    .lean();

  for (const s of SCENARIOS) {
    const patient = portal[s.patient];
    if (!patient) continue;
    const visit = s.related
      ? await Appointment.findOne({ patient: patient.patientId, status: 'completed' })
          .sort({ startAt: -1 })
          .select('_id doctor')
          .lean()
      : null;
    const input = createFollowupSchema.body.parse({
      type: s.type,
      message: s.message,
      ...(visit ? { relatedAppointmentId: visit._id.toString() } : {}),
      ...(s.attachReferral && referral ? { attachmentIds: [referral._id.toString()] } : {}),
    });
    const created = await createFollowup(patient, input, SEED_REQUEST);
    done.requests += 1;
    const doctor = visit ? await doctorActor(visit.doctor) : null;
    const actorFor = (by: Step['by']) =>
      by === 'patient' ? patient : by === 'doctor' && doctor ? doctor : reception;

    for (const step of s.steps) {
      const actor = actorFor(step.by);
      if ('say' in step) {
        await postMessage(
          actor,
          created.id,
          { text: step.say, visibility: step.internal ? 'staff' : 'all' },
          SEED_REQUEST,
        );
      } else if ('review' in step) {
        await reviewFollowup(actor, created.id, SEED_REQUEST);
      } else if ('assignOther' in step) {
        const other = await DoctorProfile.findOne({
          user: { $ne: visit?.doctor },
          isAcceptingAppointments: true,
        })
          .sort({ _id: 1 })
          .select('user')
          .lean();
        if (other) await assignFollowup(actor, created.id, other.user.toString(), SEED_REQUEST);
      } else if ('schedule' in step) {
        if (visit && (await scheduleSoon(actor, created.id, visit.doctor.toString(), today))) {
          done.scheduled += 1;
        }
      } else if ('close' in step) {
        await finishFollowup(actor, created.id, 'closed', step.close, SEED_REQUEST);
      } else {
        await finishFollowup(actor, created.id, 'rejected', step.reject, SEED_REQUEST);
      }
    }
    await backdate(created.id, s.daysAgo);
  }
  return done;
}

/** Moves a request's times back by `daysAgo` days, keeping the order of its thread. */
async function backdate(id: string, daysAgo: number) {
  const r = await FollowupRequest.findById(id).select('createdAt messages statusHistory').lean();
  if (!r) return;
  const start = new Date(Date.now() - daysAgo * 86_400_000);
  const hour = 3_600_000;
  const shift = (i: number) => new Date(start.getTime() + (i + 1) * 2 * hour);
  await FollowupRequest.collection.updateOne(
    { _id: new Types.ObjectId(id) },
    {
      $set: {
        createdAt: start,
        updatedAt: shift((r.messages?.length ?? 0) + (r.statusHistory?.length ?? 0)),
        messages: (r.messages ?? []).map((m, i) => ({ ...m, at: shift(i) })),
        statusHistory: (r.statusHistory ?? []).map((h, i) => ({
          ...h,
          at: i === 0 ? start : shift(i),
        })),
      },
    },
  );
}

export async function seedFollowups(): Promise<Record<string, number>> {
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const portal = await Promise.all(
    patientLogins()
      .filter((l) => l.email !== PENDING_SIGNUP_EMAIL)
      .map((l) => patientActor(l.email)),
  );
  const reminders = await backfillReminders(timezone);
  const planned = await plannedFollowUps(portal, today, timezone);
  const made = await requests(portal, today);
  return {
    remindersAdded: reminders,
    dueInTwoDays: planned.dueSoon,
    overdue: planned.overdue,
    created: made.requests,
    scheduled: made.scheduled,
    unchanged: made.unchanged,
  };
}
