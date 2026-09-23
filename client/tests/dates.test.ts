import { getClinicTimezone, setClinicTimezone } from '../src/utils/clinicTimezone';
import {
  addDaysToDate,
  clinicDate,
  clinicDayBoundary,
  formatClockTime,
  formatDate,
  formatDateTime,
  formatTime,
  toUtcFromClinic,
} from '../src/utils/dates';

describe('clinic dates', () => {
  afterEach(() => setClinicTimezone('Asia/Kolkata'));

  it('formats in the clinic timezone (spec §13.3 format)', () => {
    const iso = '2026-10-05T03:30:00.000Z'; // 9:00 AM in India
    expect(getClinicTimezone()).toBe('Asia/Kolkata');
    expect(formatDateTime(iso)).toBe('05 Oct 2026, 9:00 AM');
    expect(formatDate(iso)).toBe('05 Oct 2026');
    expect(formatTime(iso)).toBe('9:00 AM');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });

  it('follows the timezone from the clinic settings (incl. DST)', () => {
    setClinicTimezone('America/New_York');
    expect(formatDateTime('2026-01-15T14:00:00.000Z')).toBe('15 Jan 2026, 9:00 AM'); // EST
    expect(formatDateTime('2026-07-15T13:00:00.000Z')).toBe('15 Jul 2026, 9:00 AM'); // EDT
    expect(toUtcFromClinic('2026-07-15', '09:00')).toBe('2026-07-15T13:00:00.000Z');
  });

  it('converts clinic wall time to UTC', () => {
    expect(toUtcFromClinic('2026-10-05', '09:00')).toBe('2026-10-05T03:30:00.000Z');
    expect(toUtcFromClinic('2026-10-05')).toBe('2026-10-04T18:30:00.000Z');
  });

  it('clinic calendar helpers', () => {
    expect(clinicDate('2026-10-04T20:00:00Z')).toBe('2026-10-05'); // already the 5th in India
    expect(clinicDayBoundary('2026-10-05', 'start')).toBe('2026-10-05T00:00:00.000+05:30');
    expect(clinicDayBoundary('2026-10-05', 'end')).toBe('2026-10-05T23:59:59.999+05:30');
    expect(addDaysToDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(formatClockTime('17:30')).toBe('5:30 PM');
    expect(formatClockTime('00:05')).toBe('12:05 AM');
  });
});
