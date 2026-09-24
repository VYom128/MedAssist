// The browser is in New York, the clinic in India: the calendar must still show clinic time.
process.env.TZ = 'America/New_York';

import {
  fromClinicWallDate,
  toClinicWallDate,
  wallDateString,
  wallTimeString,
} from '../src/utils/clinicTime';

describe('clinic wall dates (react-big-calendar)', () => {
  it('runs in a browser timezone different from the clinic', () => {
    // New York is UTC−5 in January (UTC−4 in summer), never +5:30.
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(300);
  });

  it('an instant shows at its clinic wall-clock time, whatever the browser zone', () => {
    const wall = toClinicWallDate('2026-10-05T03:30:00.000Z', 'Asia/Kolkata'); // 09:00 IST
    expect(wall.getFullYear()).toBe(2026);
    expect(wall.getMonth()).toBe(9);
    expect(wall.getDate()).toBe(5);
    expect(wall.getHours()).toBe(9);
    expect(wall.getMinutes()).toBe(0);
    expect(wallDateString(wall)).toBe('2026-10-05');
    expect(wallTimeString(wall)).toBe('09:00');
  });

  it('crosses the date line correctly (late evening IST is the same clinic day)', () => {
    const wall = toClinicWallDate('2026-10-05T14:45:00.000Z', 'Asia/Kolkata'); // 20:15 IST
    expect(wallDateString(wall)).toBe('2026-10-05');
    expect(wallTimeString(wall)).toBe('20:15');
  });

  it('a clicked wall slot converts back to the right instant (round trip)', () => {
    const wall = new Date(2026, 9, 5, 17, 30); // "17:30" as shown in the calendar
    expect(fromClinicWallDate(wall, 'Asia/Kolkata').toISOString()).toBe('2026-10-05T12:00:00.000Z');
    for (const iso of ['2026-03-08T04:30:00.000Z', '2026-11-01T13:15:00.000Z']) {
      // Round trips even on New York's DST change days.
      expect(
        fromClinicWallDate(toClinicWallDate(iso, 'Asia/Kolkata'), 'Asia/Kolkata').toISOString(),
      ).toBe(iso);
    }
  });

  it('works for a clinic in a DST zone too', () => {
    const wall = toClinicWallDate('2026-07-01T08:00:00.000Z', 'Europe/London'); // 09:00 BST
    expect(wallTimeString(wall)).toBe('09:00');
    expect(fromClinicWallDate(wall, 'Europe/London').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
  });
});
