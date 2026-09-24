import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { User } from '../src/modules/users/model.js';
import { addDaysToDate, clinicToday } from '../src/utils/dates.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import {
  at,
  createBookingSetup,
  createDepartment,
  createService,
  insertAppointment,
  loginAsPatient,
  nextWeekday,
  setSettings,
  TEST_TZ,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** GET /doctors/:id/slots and /availability (spec §7.6, §8.1). */

let reception: LoggedIn;
let setup: Awaited<ReturnType<typeof createBookingSetup>>;
let day: string; // a Monday a few days ahead

const slots = (query: string, auth = reception.auth, doctorId = setup.doctorId) =>
  api().get(`/api/v1/doctors/${doctorId}/slots?${query}`).set(auth);
const availability = (query: string, auth = reception.auth) =>
  api().get(`/api/v1/doctors/${setup.doctorId}/availability?${query}`).set(auth);
const labels = (res: { body: { data: { slots: { label: string }[] } } }) =>
  res.body.data.slots.map((s) => s.label);

describe('GET /doctors/:id/slots', () => {
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    reception = await loginAs('receptionist');
    setup = await createBookingSetup();
    day = nextWeekday(1, 3);
  });

  it('returns the free slots of the day in clinic time', async () => {
    const res = await slots(`date=${day}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      date: day,
      timezone: TEST_TZ,
      slotMinutes: 15,
      serviceMinutes: 15,
    });
    expect(res.body.data.slots).toHaveLength(16); // 09:00–13:00
    expect(res.body.data.slots[0]).toEqual({
      startAt: at(day, '09:00').toISOString(),
      endAt: at(day, '09:15').toISOString(),
      label: '09:00',
    });
  });

  it("uses the doctor's own slot length and the service duration", async () => {
    await DoctorProfile.updateOne({ user: setup.doctorId }, { $set: { slotMinutes: 20 } });
    const long = await createService({ durationMinutes: 40 });
    const res = await slots(`date=${day}&serviceId=${long._id}`);
    expect(res.body.data).toMatchObject({ slotMinutes: 20, serviceMinutes: 40 });
    expect(labels(res).at(-1)).toBe('12:20'); // 12:20–13:00 is the last 40-minute fit
  });

  it('removes booked slots but not cancelled ones', async () => {
    await insertAppointment({
      patient: setup.patient.id,
      doctor: setup.doctorId,
      startAt: at(day, '09:00'),
      minutes: 30,
    });
    await insertAppointment({
      patient: setup.patient.id,
      doctor: setup.doctorId,
      startAt: at(day, '10:00'),
      status: 'cancelled',
    });
    const res = await slots(`date=${day}`);
    expect(labels(res).slice(0, 5)).toEqual(['09:30', '09:45', '10:00', '10:15', '10:30']);
  });

  it('removes slots during leave; full-day leave → []', async () => {
    await DoctorLeave.create({
      doctor: setup.doctorId,
      startAt: at(day, '09:00'),
      endAt: at(day, '12:00'),
    });
    expect(labels(await slots(`date=${day}`))).toEqual(['12:00', '12:15', '12:30', '12:45']);
    const next = addDaysToDate(day, 1);
    await DoctorLeave.create({
      doctor: setup.doctorId,
      startAt: at(next, '00:00'),
      endAt: at(addDaysToDate(next, 1), '00:00'),
    });
    expect((await slots(`date=${next}`)).body.data.slots).toEqual([]);
  });

  it('non-working day (clinic closed on Sunday) → []', async () => {
    expect((await slots(`date=${nextWeekday(0, 3)}`)).body.data.slots).toEqual([]);
  });

  it('no schedule covering the date, or a day off in the template → []', async () => {
    await DoctorSchedule.updateMany(
      { doctor: setup.doctorId, weekday: 1 },
      { $set: { sessions: [] } },
    );
    expect((await slots(`date=${day}`)).body.data.slots).toEqual([]);
    await DoctorSchedule.deleteMany({ doctor: setup.doctorId });
    expect((await slots(`date=${addDaysToDate(day, 1)}`)).body.data.slots).toEqual([]);
  });

  it('inactive doctors and doctors not accepting appointments → []', async () => {
    await DoctorProfile.updateOne(
      { user: setup.doctorId },
      { $set: { isAcceptingAppointments: false } },
    );
    expect((await slots(`date=${day}`)).body.data.slots).toEqual([]);
    await DoctorProfile.updateOne(
      { user: setup.doctorId },
      { $set: { isAcceptingAppointments: true } },
    );
    await User.updateOne({ _id: setup.doctorId }, { $set: { isActive: false } });
    expect((await slots(`date=${day}`)).body.data.slots).toEqual([]);
  });

  it('past dates → 422 OUTSIDE_BOOKING_WINDOW for everyone', async () => {
    const yesterday = addDaysToDate(clinicToday(TEST_TZ), -1);
    const res = await slots(`date=${yesterday}`);
    expect(res.status).toBe(422);
    expectErrorShape(res.body, 'OUTSIDE_BOOKING_WINDOW');
  });

  it('beyond bookingWindowDays: 422 for patients, allowed for staff', async () => {
    await setSettings({ 'appointment.bookingWindowDays': 7 });
    const far = nextWeekday(1, 9);
    const me = await loginAsPatient();
    expectErrorShape((await slots(`date=${far}`, me.auth)).body, 'OUTSIDE_BOOKING_WINDOW');
    expect((await slots(`date=${far}`)).status).toBe(200);
  });

  it('any logged-in role; 401 without a token', async () => {
    for (const role of ['admin', 'doctor', 'labtech'] as const) {
      expect((await slots(`date=${day}`, (await loginAs(role)).auth)).status, role).toBe(200);
    }
    expect((await api().get(`/api/v1/doctors/${setup.doctorId}/slots?date=${day}`)).status).toBe(
      401,
    );
  });

  it('validation and unknown records', async () => {
    expect((await slots('')).status).toBe(400);
    expect((await slots('date=2026-02-30')).status).toBe(400);
    expect((await slots(`date=${day}`, reception.auth, '0123456789abcdef01234567')).status).toBe(
      404,
    );
    const inactive = await createService({ isActive: false });
    expect((await slots(`date=${day}&serviceId=${inactive._id}`)).status).toBe(404);
    const otherDept = await createService({ department: (await createDepartment())._id });
    expect((await slots(`date=${day}&serviceId=${otherDept._id}`)).status).toBe(422);
  });
});

describe('GET /doctors/:id/availability', () => {
  beforeEach(async () => {
    await resetDb();
    reception = await loginAs('receptionist');
    setup = await createBookingSetup();
    day = nextWeekday(1, 3);
  });

  it('free slots per day, with bookings, leave and closed days', async () => {
    await insertAppointment({
      patient: setup.patient.id,
      doctor: setup.doctorId,
      startAt: at(day, '09:00'),
    });
    await DoctorLeave.create({
      doctor: setup.doctorId,
      startAt: at(addDaysToDate(day, 1), '00:00'),
      endAt: at(addDaysToDate(day, 2), '00:00'),
    });
    const res = await availability(`from=${day}&to=${addDaysToDate(day, 6)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toEqual([
      { date: day, freeSlots: 15 }, // Monday, one booked
      { date: addDaysToDate(day, 1), freeSlots: 0 }, // leave
      { date: addDaysToDate(day, 2), freeSlots: 16 },
      { date: addDaysToDate(day, 3), freeSlots: 16 },
      { date: addDaysToDate(day, 4), freeSlots: 16 },
      { date: addDaysToDate(day, 5), freeSlots: 16 }, // Saturday
      { date: addDaysToDate(day, 6), freeSlots: 0 }, // Sunday: clinic closed
    ]);
  });

  it('past days and (for patients) days beyond the window have 0', async () => {
    await setSettings({ 'appointment.bookingWindowDays': 7 });
    const today = clinicToday(TEST_TZ);
    const from = addDaysToDate(today, -2);
    const to = addDaysToDate(today, 14);
    const me = await loginAsPatient();
    const patientDays = (await availability(`from=${from}&to=${to}`, me.auth)).body.data.days;
    const staffDays = (await availability(`from=${from}&to=${to}`)).body.data.days;
    const byDate = (days: { date: string; freeSlots: number }[], date: string) =>
      days.find((d) => d.date === date)!.freeSlots;
    expect(byDate(patientDays, from)).toBe(0);
    const farMonday = nextWeekday(1, 8); // 8–14 days ahead: beyond the 7-day window
    expect(byDate(patientDays, farMonday)).toBe(0);
    expect(byDate(staffDays, farMonday)).toBe(16);
  });

  it('reads schedules, leave and appointments once for the whole range', async () => {
    const counts = {
      appointments: vi.spyOn(Appointment, 'find'),
      leaves: vi.spyOn(DoctorLeave, 'find'),
      schedules: vi.spyOn(DoctorSchedule, 'find'),
      scheduleOne: vi.spyOn(DoctorSchedule, 'findOne'),
    };
    const res = await availability(`from=${day}&to=${addDaysToDate(day, 30)}`);
    expect(res.body.data.days).toHaveLength(31);
    expect(counts.appointments).toHaveBeenCalledTimes(1);
    expect(counts.leaves).toHaveBeenCalledTimes(1);
    expect(counts.schedules).toHaveBeenCalledTimes(1);
    expect(counts.scheduleOne).not.toHaveBeenCalled();
    Object.values(counts).forEach((spy) => spy.mockRestore());
  });

  it('at most 31 days; from/to required and ordered', async () => {
    expect((await availability(`from=${day}&to=${addDaysToDate(day, 31)}`)).status).toBe(400);
    expect((await availability(`from=${day}`)).status).toBe(400);
    expect((await availability(`from=${day}&to=${addDaysToDate(day, -1)}`)).status).toBe(400);
  });
});
