import { Counter } from '../src/modules/counters/model.js';
import { formatNumber, nextSequence } from '../src/services/counter.service.js';
import { withTransaction } from '../src/utils/transaction.js';
import { resetDb } from './helpers/auth.js';

describe('counter service (spec §6.27, §8.10)', () => {
  beforeEach(resetDb);

  it('starts at 1 and increments per key', async () => {
    expect(await nextSequence('mrn')).toBe(1);
    expect(await nextSequence('mrn')).toBe(2);
    expect(await nextSequence('appointment:2026')).toBe(1);
    expect(await Counter.findById('mrn').lean()).toEqual({ _id: 'mrn', seq: 2 });
  });

  it('50 parallel calls give 50 unique, consecutive numbers', async () => {
    const numbers = await Promise.all(Array.from({ length: 50 }, () => nextSequence('race')));
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('an aborted transaction does not use up a number', async () => {
    await nextSequence('invoice:2026');
    await expect(
      withTransaction(async (session) => {
        await nextSequence('invoice:2026', { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await nextSequence('invoice:2026')).toBe(2);
  });

  it('formats numbers per §8.10', () => {
    expect(formatNumber('MRN', 1)).toBe('MRN-000001');
    expect(formatNumber('APT', 45, { year: 2026 })).toBe('APT-2026-000045');
    expect(formatNumber('INV', 1_234_567, { year: 2026 })).toBe('INV-2026-1234567');
    expect(formatNumber('T', 7, { pad: 3 })).toBe('T-007');
  });
});
