import type { Types } from 'mongoose';
import { Appointment } from '../../src/modules/appointments/model.js';
import { Department } from '../../src/modules/departments/model.js';
import { DoctorProfile } from '../../src/modules/doctors/model.js';
import { Patient } from '../../src/modules/patients/model.js';
import { insertPatient } from '../../src/modules/patients/service.js';
import { DoctorSchedule } from '../../src/modules/schedules/model.js';
import { Service } from '../../src/modules/services/model.js';
import { ClinicSettings } from '../../src/modules/settings/model.js';
import { clearSettingsCache, getSettings } from '../../src/modules/settings/service.js';
import {
  addDaysToDate,
  calendarDate,
  clinicToday,
  weekdayOf,
  zonedDateTimeToUtc,
} from '../../src/utils/dates.js';
import { createUser, loginAs, type LoggedIn } from './auth.js';
import { api } from './testApp.js';
import { letters } from './rbacMatrix.js';

let n = 0;

/** An active department with a unique name and code. */
export async function createDepartment(overrides: Record<string, unknown> = {}) {
  n += 1;
  return Department.create({ name: `Department ${n}`, code: `DP${letters(n)}`, ...overrides });
}

/** Adds a doctor profile to an existing doctor User. */
export async function addDoctorProfile(userId: unknown, overrides: Record<string, unknown> = {}) {
  n += 1;
  const department = overrides.department ?? (await createDepartment())._id;
  return DoctorProfile.create({
    user: userId,
    department,
    specialization: 'General Physician',
    registrationNumber: `KMC-${n}`,
    ...overrides,
  });
}

/** A doctor User (active unless overridden) with a profile. */
export async function createDoctor(
  userOverrides: Record<string, unknown> = {},
  profileOverrides: Record<string, unknown> = {},
) {
  const user = await createUser('doctor', userOverrides);
  const profile = await addDoctorProfile(user._id, profileOverrides);
  return { user, profile, id: user._id.toString() };
}

/** Logs in as a doctor who has a profile. */
export async function loginAsDoctor(
  profileOverrides: Record<string, unknown> = {},
): Promise<LoggedIn & { id: string }> {
  const me = await loginAs('doctor');
  await addDoctorProfile(me.user._id, profileOverrides);
  return { ...me, id: me.user._id.toString() };
}

let p = 0;

/** A unique valid Indian mobile number in E.164 ('+919000000001', …). */
export const uniquePhone = () => {
  p += 1;
  return `+9190${String(p).padStart(8, '0')}`;
};

/**
 * A patient (through the service's insert, so it gets a real MRN). Overrides use stored forms:
 * E.164 phone, `dateOfBirth` as 'YYYY-MM-DD'.
 */
export async function createPatient(
  overrides: Record<string, unknown> & { dateOfBirth?: string } = {},
) {
  p += 1;
  const { dateOfBirth = '1985-06-15', ...rest } = overrides;
  const created = await insertPatient({
    firstName: 'Test',
    lastName: `Patient${p}`,
    dateOfBirth: calendarDate(dateOfBirth),
    gender: 'female',
    phone: uniquePhone(),
    consent: { dataProcessing: { given: true, at: new Date() } },
    ...rest,
  } as never);
  return { patient: created, id: created._id.toString() };
}

/** Logs in as a patient user linked to a new Patient record (or to `patientOverrides`' one). */
export async function loginAsPatient(
  patientOverrides: Record<string, unknown> & { dateOfBirth?: string } = {},
): Promise<LoggedIn & { patientId: string }> {
  const { id } = await createPatient(patientOverrides);
  const me = await loginAs('patient', { patient: id, patientLinkStatus: 'linked' });
  await Patient.updateOne({ _id: id }, { $set: { user: me.user._id } });
  return { ...me, patientId: id };
}

// ---- Appointments (Phase 4) -----------------------------------------------------------------

/** The settings default clinic timezone, which tests use unless they change it. */
export const TEST_TZ = 'Asia/Kolkata';

/** UTC instant of a clinic wall-clock time: at('2026-10-05', '09:00') → 03:30Z. */
export const at = (date: string, time: string) => zonedDateTimeToUtc(date, time, TEST_TZ);

/** The first clinic date on `weekday` (0 = Sunday) at least `minDays` after today. */
export function nextWeekday(weekday: number, minDays = 2): string {
  let date = addDaysToDate(clinicToday(TEST_TZ), minDays);
  while (weekdayOf(date) !== weekday) date = addDaysToDate(date, 1);
  return date;
}

type Sessions = { start: string; end: string; maxWalkIns?: number }[];

/**
 * A weekly schedule with the same sessions every weekday (default 09:00–13:00), in effect from
 * 30 days ago. The clinic's working days (Mon–Sat by default) still apply on top.
 */
export async function createSchedule(
  doctorId: string | Types.ObjectId,
  sessions: Sessions = [{ start: '09:00', end: '13:00' }],
) {
  const effectiveFrom = calendarDate(addDaysToDate(clinicToday(TEST_TZ), -30));
  await DoctorSchedule.insertMany(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      doctor: doctorId,
      weekday,
      sessions,
      effectiveFrom,
    })),
  );
}

let s = 0;

/** An active, clinic-wide 15-minute consultation (override durationMinutes, department…). */
export async function createService(overrides: Record<string, unknown> = {}) {
  s += 1;
  return Service.create({
    code: `APT-SVC-${s}`,
    name: 'Consultation',
    type: 'consultation',
    durationMinutes: 15,
    pricePaise: 50_000,
    ...overrides,
  });
}

let a = 0;

/**
 * Inserts an appointment directly, bypassing the booking rules – for statuses and times the API
 * cannot produce (checked in, completed, in the past, within the cancellation window).
 */
export async function insertAppointment({
  patient,
  doctor,
  startAt,
  minutes = 15,
  status = 'scheduled',
  ...rest
}: {
  patient: string | Types.ObjectId;
  doctor: string | Types.ObjectId;
  startAt: Date;
  minutes?: number;
  status?: string;
  [key: string]: unknown;
}) {
  a += 1;
  return Appointment.create({
    appointmentNumber: `APT-1999-${String(a).padStart(6, '0')}`,
    patient,
    doctor,
    serviceSnapshot: { name: 'Consultation', durationMinutes: minutes, pricePaise: 50_000 },
    startAt,
    endAt: new Date(startAt.getTime() + minutes * 60_000),
    source: 'reception',
    status,
    ...rest,
  });
}

/**
 * A bookable setup: a doctor with a 09:00–13:00 schedule every day, a 15-min service and a
 * patient. Call `await Appointment.init()` once per file so the unique slot index exists.
 */
export async function createBookingSetup() {
  const doctor = await createDoctor();
  await createSchedule(doctor.id);
  const service = await createService();
  const patient = await createPatient();
  return { doctor, doctorId: doctor.id, service, serviceId: service._id.toString(), patient };
}

/** Changes clinic settings directly (dotted paths, e.g. 'appointment.minCancelHours'). */
export async function setSettings(values: Record<string, unknown>) {
  await getSettings(); // creates the document with the defaults
  await ClinicSettings.updateOne({}, { $set: values });
  clearSettingsCache();
}

/**
 * Sets the clinic timezone to a fixed-offset zone where it is about midday right now (12:00–
 * 12:59), so tests that need "today" or "a session running now" do not depend on when they run.
 * @returns the zone, e.g. 'Etc/GMT-5' (= UTC+5).
 */
export async function useMiddayClinicZone(): Promise<string> {
  const offset = 12 - new Date().getUTCHours(); // -11 … +12
  const tz = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
  await setSettings({ timezone: tz });
  return tz;
}

// ---- Consultations and encounters (Phase 5) --------------------------------------------------

let consult = 0;

/**
 * A checked-in appointment of a new patient (or `patientId`) with `doctorId`, today in the clinic
 * timezone (call `useMiddayClinicZone()` first so "today" is safe). Each call takes the next
 * minute after 08:00, so appointments never overlap.
 */
export async function checkedInToday(
  doctorId: string,
  { patientId, ...rest }: { patientId?: string } & Record<string, unknown> = {},
) {
  consult += 1;
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const startAt = new Date(
    zonedDateTimeToUtc(today, '08:00', timezone).getTime() + consult * 60_000,
  );
  const patient = patientId ?? (await createPatient()).id;
  const appt = await insertAppointment({
    patient,
    doctor: doctorId,
    startAt,
    minutes: 1,
    status: 'checked_in',
    queue: { tokenNumber: consult, checkedInAt: new Date(Date.now() - 10 * 60_000) },
    ...rest,
  });
  return { appointmentId: appt._id.toString(), patientId: patient.toString(), startAt };
}

/**
 * A doctor in consultation: logs in a doctor (or uses `doctor`), checks in a patient today and
 * starts the consultation through the API (which creates the draft encounter).
 */
export async function startedConsultation(
  doctor?: LoggedIn & { id: string },
  options: { patientId?: string } = {},
) {
  const me = doctor ?? (await loginAsDoctor());
  const { appointmentId, patientId } = await checkedInToday(me.id, options);
  const res = await api().post(`/api/v1/appointments/${appointmentId}/start`).set(me.auth);
  if (res.status !== 200)
    throw new Error(`start failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    doctor: me,
    appointmentId,
    patientId,
    encounterId: res.body.data.encounterId as string,
  };
}
