import { Types } from 'mongoose';
import { JOBS } from '../src/jobs/index.js';
import { runPrescriptionCompletionJob } from '../src/jobs/prescriptionCompletion.job.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { auditEntries, resetDb } from './helpers/auth.js';

/** Prescription completion (spec §5.3, §8.11). */

const NOW = new Date('2026-10-20T20:30:00Z'); // 02:00 IST on the 21st
const DAY = 86_400_000;
let n = 0;

/** A prescription issued `daysAgo` before NOW with items lasting `durations` days. */
async function prescription(
  daysAgo: number,
  durations: (number | null)[],
  status: 'issued' | 'draft' | 'cancelled' | 'completed' = 'issued',
) {
  n += 1;
  const doc = await Prescription.create({
    prescriptionNumber: `RX-2026-${String(n).padStart(6, '0')}`,
    encounter: new Types.ObjectId(),
    appointment: new Types.ObjectId(),
    patient: new Types.ObjectId(),
    doctor: new Types.ObjectId(),
    items: durations.map((d, i) => ({
      drugName: `Drug ${i}`,
      dose: '1 tablet',
      frequency: 'OD',
      ...(d ? { durationDays: d } : {}),
    })),
  });
  // Straight to the target state (the model only allows status bookkeeping after issue).
  await Prescription.collection.updateOne(
    { _id: doc._id },
    { $set: { status, issuedAt: new Date(NOW.getTime() - daysAgo * DAY) } },
  );
  return doc._id;
}

const statusOf = async (id: Types.ObjectId) => (await Prescription.findById(id).lean())?.status;

describe('runPrescriptionCompletionJob', () => {
  beforeEach(resetDb);

  it('completes issued prescriptions once the longest item duration has passed', async () => {
    const done = await prescription(8, [3, 7]); // longest 7 days, issued 8 days ago
    const exact = await prescription(5, [5]); // exactly 5 days ago
    const running = await prescription(5, [3, 7]); // 2 days to go
    const cancelled = await prescription(30, [5], 'cancelled');
    const draft = await prescription(30, [5], 'draft');

    expect(await runPrescriptionCompletionJob(NOW)).toEqual({
      completed: 2,
      skipped: 0,
      failed: 0,
    });
    expect(await statusOf(done)).toBe('completed');
    expect(await statusOf(exact)).toBe('completed');
    expect(await statusOf(running)).toBe('issued');
    expect(await statusOf(cancelled)).toBe('cancelled');
    expect(await statusOf(draft)).toBe('draft');
    expect((await Prescription.findById(done).lean())?.completedAt?.toISOString()).toBe(
      NOW.toISOString(),
    );

    const entries = await auditEntries('prescription.complete');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actor: { user: null, role: 'system' },
      metadata: { via: 'job' },
    });
  });

  it('never completes one twice; items without a duration do not complete it at once', async () => {
    await prescription(10, [2]);
    const noDuration = await prescription(10, [null]);
    expect((await runPrescriptionCompletionJob(NOW)).completed).toBe(1);
    expect(await runPrescriptionCompletionJob(NOW)).toEqual({
      completed: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await statusOf(noDuration)).toBe('issued');
    expect(await auditEntries('prescription.complete')).toHaveLength(1);
  });

  it('is scheduled daily at 02:00 (clinic time)', () => {
    expect(JOBS.find((j) => j.name === 'prescription-completion')?.rule).toBe('0 2 * * *');
  });
});
