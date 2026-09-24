import { generateSlots, overlaps, slotGrid } from '../../src/modules/appointments/slots.js';
import { zonedDateTimeToUtc } from '../../src/utils/dates.js';

/** Slot engine (spec §8.1): pure, so every rule is tested without a database. */

const IST = 'Asia/Kolkata';
const LONDON = 'Europe/London';
const DATE = '2026-10-05'; // a Monday
const ist = (time: string, date = DATE) => zonedDateTimeToUtc(date, time, IST);
const range = (from: string, to: string, date = DATE) => ({
  startAt: ist(from, date),
  endAt: ist(to, date),
});
/** Well before the day, so the lead-time rule removes nothing. */
const EARLIER = new Date('2026-10-01T00:00:00Z');
const labels = (slots: { label: string }[]) => slots.map((s) => s.label);

const base = {
  date: DATE,
  schedule: {
    sessions: [
      { start: '09:00', end: '10:00' },
      { start: '17:00', end: '17:30' },
    ],
  },
  slotMinutes: 15,
  now: EARLIER,
  timezone: IST,
};

describe('overlaps', () => {
  it('half-open ranges: touching is not overlapping', () => {
    expect(overlaps(range('09:00', '09:15'), range('09:15', '09:30'))).toBe(false);
    expect(overlaps(range('09:00', '09:30'), range('09:15', '09:30'))).toBe(true);
    expect(overlaps(range('09:10', '09:20'), range('09:00', '09:30'))).toBe(true);
  });
});

describe('generateSlots', () => {
  it('steps through every session in slotMinutes, converting clinic time to UTC', () => {
    const slots = generateSlots(base);
    expect(labels(slots)).toEqual(['09:00', '09:15', '09:30', '09:45', '17:00', '17:15']);
    // 09:00 in India (UTC+5:30, no DST) is 03:30 UTC.
    expect(slots[0]).toEqual({
      startAt: new Date('2026-10-05T03:30:00.000Z'),
      endAt: new Date('2026-10-05T03:45:00.000Z'),
      label: '09:00',
    });
    expect(slots.at(-1)!.endAt).toEqual(new Date('2026-10-05T12:00:00.000Z')); // 17:30 IST
  });

  it('uses the slot length as the step (e.g. a doctor with 20-minute slots)', () => {
    expect(labels(generateSlots({ ...base, slotMinutes: 20 }))).toEqual([
      '09:00',
      '09:20',
      '09:40',
      '17:00',
    ]);
  });

  it('a service longer than one slot needs enough consecutive time before the session ends', () => {
    const slots = generateSlots({ ...base, serviceMinutes: 30 });
    expect(labels(slots)).toEqual(['09:00', '09:15', '09:30', '17:00']);
    expect(slots[0]!.endAt).toEqual(ist('09:30'));
  });

  it('a longer service skips starts that would run into a booking', () => {
    const slots = generateSlots({ ...base, serviceMinutes: 30, booked: [range('09:30', '09:45')] });
    // 09:00–09:30 touches the booking (fine); 09:15 and 09:30 would overlap it.
    expect(labels(slots)).toEqual(['09:00', '17:00']);
  });

  it('removes booked slots, including a longer booking covering several slots', () => {
    const slots = generateSlots({
      ...base,
      booked: [range('09:15', '09:30'), range('17:00', '17:30')],
    });
    expect(labels(slots)).toEqual(['09:00', '09:30', '09:45']);
  });

  it('removes slots during full-day leave', () => {
    const leave = { startAt: ist('00:00'), endAt: ist('00:00', '2026-10-06') };
    expect(generateSlots({ ...base, leaves: [leave] })).toEqual([]);
  });

  it('removes only the slots overlapping partial leave', () => {
    expect(labels(generateSlots({ ...base, leaves: [range('09:20', '09:40')] }))).toEqual([
      '09:00',
      '09:45',
      '17:00',
      '17:15',
    ]);
  });

  it('leave on another day changes nothing', () => {
    const leave = range('00:00', '23:59', '2026-10-04');
    expect(generateSlots({ ...base, leaves: [leave] })).toHaveLength(6);
  });

  it('today: drops slots starting within the next 15 minutes (and every past slot)', () => {
    expect(labels(generateSlots({ ...base, now: ist('09:10') }))).toEqual([
      '09:30',
      '09:45',
      '17:00',
      '17:15',
    ]);
    // A slot starting exactly 15 minutes from now is still offered.
    expect(labels(generateSlots({ ...base, now: ist('09:15') }))[0]).toBe('09:30');
    expect(labels(generateSlots({ ...base, now: ist('09:00') }))[0]).toBe('09:15');
  });

  it('a past day has no slots', () => {
    expect(generateSlots({ ...base, now: ist('08:00', '2026-10-06') })).toEqual([]);
  });

  it('non-working day: no schedule, or a day with no sessions', () => {
    expect(generateSlots({ ...base, schedule: null })).toEqual([]);
    expect(generateSlots({ ...base, schedule: { sessions: [] } })).toEqual([]);
  });

  it('a session too short for the service has no slots', () => {
    expect(
      generateSlots({
        ...base,
        schedule: { sessions: [{ start: '09:00', end: '09:20' }] },
        serviceMinutes: 30,
      }),
    ).toEqual([]);
  });
});

describe('slotGrid around daylight-saving changes (Europe/London)', () => {
  const grid = (date: string, start: string, end: string) =>
    slotGrid({ date, schedule: { sessions: [{ start, end }] }, slotMinutes: 30, timezone: LONDON });

  it('keeps clinic wall-clock times on both sides of the spring change', () => {
    // 29 Mar 2026: clocks go from 01:00 GMT to 02:00 BST.
    expect(grid('2026-03-28', '09:00', '10:00').map((s) => s.startAt.toISOString())).toEqual([
      '2026-03-28T09:00:00.000Z', // GMT = UTC
      '2026-03-28T09:30:00.000Z',
    ]);
    expect(grid('2026-03-30', '09:00', '10:00').map((s) => s.startAt.toISOString())).toEqual([
      '2026-03-30T08:00:00.000Z', // BST = UTC+1
      '2026-03-30T08:30:00.000Z',
    ]);
  });

  it('does not offer wall times that do not exist on the change day', () => {
    const slots = grid('2026-03-29', '00:30', '03:00');
    expect(labels(slots)).toEqual(['00:30', '02:00', '02:30']); // 01:00 and 01:30 never happen
    expect(slots.map((s) => s.startAt.toISOString())).toEqual([
      '2026-03-29T00:30:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '2026-03-29T01:30:00.000Z',
    ]);
  });

  it('offers the repeated hour once on the autumn change, without overlaps', () => {
    // 25 Oct 2026: clocks go back from 02:00 BST to 01:00 GMT.
    const slots = grid('2026-10-25', '00:30', '02:30');
    expect(labels(slots)).toEqual(['00:30', '01:00', '01:30', '02:00']);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i]!.startAt.getTime()).toBeGreaterThanOrEqual(slots[i - 1]!.endAt.getTime());
    }
  });

  it('Asia/Kolkata has no DST: 09:00 is 03:30 UTC all year', () => {
    for (const date of ['2026-01-15', '2026-03-29', '2026-07-01', '2026-10-25']) {
      const [first] = slotGrid({
        date,
        schedule: { sessions: [{ start: '09:00', end: '09:30' }] },
        slotMinutes: 15,
        timezone: IST,
      });
      expect(first!.startAt.toISOString()).toBe(`${date}T03:30:00.000Z`);
    }
  });
});
