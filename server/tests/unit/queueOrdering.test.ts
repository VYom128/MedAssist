import { compareQueue, orderQueue, type QueueEntry } from '../../src/modules/queue/ordering.js';

/** Queue order (spec §4.6, §8.4). */

const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00.000Z`);
const entry = (
  name: string,
  over: Partial<QueueEntry> & { checkedInAt?: string; token?: number } = {},
): QueueEntry & { name: string } => ({
  name,
  priority: over.priority ?? 'normal',
  type: over.type ?? 'new',
  startAt: over.startAt ?? t('09:00'),
  queue: {
    checkedInAt: over.checkedInAt ? t(over.checkedInAt) : t('08:50'),
    tokenNumber: over.token ?? 1,
  },
});
const names = (entries: (QueueEntry & { name: string })[]) =>
  orderQueue(entries).map((e) => e.name);

describe('queue ordering', () => {
  it('priority first: emergency, then priority, then normal', () => {
    expect(
      names([
        entry('normal', { startAt: t('09:00') }),
        entry('priority', { priority: 'priority', startAt: t('11:00') }),
        entry('emergency', { priority: 'emergency', startAt: t('12:00') }),
      ]),
    ).toEqual(['emergency', 'priority', 'normal']);
  });

  it('then the scheduled time, whatever the check-in order', () => {
    expect(
      names([
        entry('10:00', { startAt: t('10:00'), checkedInAt: '08:00' }),
        entry('09:30', { startAt: t('09:30'), checkedInAt: '09:25' }),
      ]),
    ).toEqual(['09:30', '10:00']);
  });

  it('walk-ins count from their check-in time, not their slot', () => {
    expect(
      names([
        entry('booked 10:00', { startAt: t('10:00'), checkedInAt: '09:55' }),
        entry('walk-in at 09:40', {
          type: 'walk_in',
          startAt: t('11:00'), // the free slot it was given
          checkedInAt: '09:40',
        }),
        entry('booked 09:30', { startAt: t('09:30'), checkedInAt: '09:35' }),
      ]),
    ).toEqual(['booked 09:30', 'walk-in at 09:40', 'booked 10:00']);
  });

  it('then check-in time, then token', () => {
    expect(
      names([
        entry('late', { checkedInAt: '09:05', token: 1 }),
        entry('early', { checkedInAt: '08:40', token: 2 }),
      ]),
    ).toEqual(['early', 'late']);
    expect(names([entry('b', { token: 7 }), entry('a', { token: 3 })])).toEqual(['a', 'b']);
  });

  it('an emergency walk-in goes before an earlier normal booking', () => {
    expect(
      names([
        entry('normal 09:00', { startAt: t('09:00') }),
        entry('emergency walk-in', {
          type: 'walk_in',
          priority: 'emergency',
          checkedInAt: '10:30',
        }),
      ]),
    ).toEqual(['emergency walk-in', 'normal 09:00']);
  });

  it('does not change the input array; compare is antisymmetric', () => {
    const input = [entry('b', { startAt: t('10:00') }), entry('a', { startAt: t('09:00') })];
    orderQueue(input);
    expect(input.map((e) => e.name)).toEqual(['b', 'a']);
    expect(Math.sign(compareQueue(input[0]!, input[1]!))).toBe(
      -Math.sign(compareQueue(input[1]!, input[0]!)),
    );
  });
});
