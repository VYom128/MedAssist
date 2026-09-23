import { scheduleIssues, type DayInput } from '../../src/modules/schedules/validation.js';

const day = (weekday: number, ...sessions: [string, string][]): DayInput => ({
  weekday,
  sessions: sessions.map(([start, end]) => ({ start, end })),
});

describe('scheduleIssues (spec §6.9)', () => {
  it('accepts separate and touching sessions, and empty days', () => {
    expect(
      scheduleIssues([
        day(1, ['09:00', '13:00'], ['17:00', '20:00']),
        day(2, ['09:00', '13:00'], ['13:00', '14:00']),
        day(0),
      ]),
    ).toEqual([]);
  });

  it('start must be before end', () => {
    expect(scheduleIssues([day(1, ['13:00', '09:00'])])).toEqual([
      { path: ['days', 0, 'sessions', 0, 'end'], message: 'End must be after start' },
    ]);
    expect(scheduleIssues([day(1, ['09:00', '09:00'])])).toHaveLength(1);
  });

  it('times must be on 5-minute steps', () => {
    expect(scheduleIssues([day(1, ['09:03', '12:58'])]).map((i) => i.path.at(-1))).toEqual([
      'start',
      'end',
    ]);
  });

  it('overlapping sessions are rejected, whatever order they are sent in', () => {
    expect(scheduleIssues([day(3, ['12:00', '15:00'], ['09:00', '13:00'])])).toEqual([
      {
        path: ['days', 0, 'sessions', 0, 'start'],
        message: 'Overlaps the 09:00–13:00 session',
      },
    ]);
    expect(scheduleIssues([day(3, ['09:00', '18:00'], ['10:00', '11:00'])])).toHaveLength(1);
  });

  it('each weekday only once', () => {
    expect(scheduleIssues([day(1), day(1)])).toEqual([
      { path: ['days', 1, 'weekday'], message: 'Each weekday may appear only once' },
    ]);
  });
});
