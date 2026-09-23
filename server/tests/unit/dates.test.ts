import {
  addDaysToDate,
  clinicToday,
  endOfClinicDay,
  isValidDateOnly,
  isValidTimeHHmm,
  isValidTimezone,
  minutesToTime,
  startOfClinicDay,
  timeToMinutes,
  toClinicDate,
  zonedDateTimeToUtc,
} from '../../src/utils/dates.js';

const iso = (d: Date) => d.toISOString();

describe('clinic time helpers', () => {
  it('validates HH:mm', () => {
    for (const ok of ['00:00', '09:05', '23:59']) expect(isValidTimeHHmm(ok)).toBe(true);
    for (const bad of ['24:00', '9:00', '09:60', '0900', '09:00:00', '']) {
      expect(isValidTimeHHmm(bad)).toBe(false);
    }
  });

  it('converts between HH:mm and minutes', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1439)).toBe('23:59');
    expect(() => minutesToTime(1440)).toThrow(RangeError);
    expect(() => timeToMinutes('25:00')).toThrow(RangeError);
  });

  it('validates IANA timezones', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('IST')).toBe(false);
  });

  it('validates calendar dates', () => {
    expect(isValidDateOnly('2026-02-28')).toBe(true);
    expect(isValidDateOnly('2028-02-29')).toBe(true);
    expect(isValidDateOnly('2026-02-29')).toBe(false);
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('26-01-01')).toBe(false);
  });

  describe('Asia/Kolkata (UTC+05:30, no DST)', () => {
    const tz = 'Asia/Kolkata';
    it('converts clinic wall time to UTC', () => {
      expect(iso(zonedDateTimeToUtc('2026-10-05', '09:00', tz))).toBe('2026-10-05T03:30:00.000Z');
      expect(iso(zonedDateTimeToUtc('2026-10-05', '00:15', tz))).toBe('2026-10-04T18:45:00.000Z');
    });
    it('clinic day boundaries', () => {
      expect(iso(startOfClinicDay('2026-10-05', tz))).toBe('2026-10-04T18:30:00.000Z');
      expect(iso(endOfClinicDay('2026-10-05', tz))).toBe('2026-10-05T18:29:59.999Z');
      // 20:00 UTC on 4 Oct is already 5 Oct in India.
      const instant = new Date('2026-10-04T20:00:00Z');
      expect(toClinicDate(instant, tz)).toBe('2026-10-05');
      expect(iso(startOfClinicDay(instant, tz))).toBe('2026-10-04T18:30:00.000Z');
      expect(clinicToday(tz, instant)).toBe('2026-10-05');
    });
  });

  describe('America/New_York (DST)', () => {
    const tz = 'America/New_York';
    it('uses the offset in force on that date', () => {
      expect(iso(zonedDateTimeToUtc('2026-01-15', '09:00', tz))).toBe('2026-01-15T14:00:00.000Z'); // EST
      expect(iso(zonedDateTimeToUtc('2026-07-15', '09:00', tz))).toBe('2026-07-15T13:00:00.000Z'); // EDT
    });
    it('spring-forward day is 23 hours long', () => {
      // DST starts 2026-03-08 at 02:00 local.
      const start = startOfClinicDay('2026-03-08', tz);
      const end = endOfClinicDay('2026-03-08', tz);
      expect(iso(start)).toBe('2026-03-08T05:00:00.000Z');
      expect(iso(end)).toBe('2026-03-09T03:59:59.999Z');
      expect((end.getTime() + 1 - start.getTime()) / 3_600_000).toBe(23);
      expect(iso(zonedDateTimeToUtc('2026-03-08', '03:00', tz))).toBe('2026-03-08T07:00:00.000Z');
    });
    it('fall-back day is 25 hours long', () => {
      // DST ends 2026-11-01 at 02:00 local.
      const start = startOfClinicDay('2026-11-01', tz);
      const end = endOfClinicDay('2026-11-01', tz);
      expect((end.getTime() + 1 - start.getTime()) / 3_600_000).toBe(25);
    });
  });

  it('adds calendar days across months and DST changes', () => {
    expect(addDaysToDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDate('2026-03-07', 2)).toBe('2026-03-09');
  });
});
