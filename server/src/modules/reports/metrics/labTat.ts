import { LabOrder } from '../../labOrders/model.js';
import { inRange, percentile, type ClinicRange } from './range.js';

/**
 * Lab turnaround (spec §14, Phase 10 decision): hours from the order being placed (`orderedAt`)
 * to its release (`releasedAt`) for orders released in the range – per test (each not-cancelled
 * test of a released order counts once) with the median, the 90th percentile and how many took
 * longer than the test's turnaround time. `orderedAt`, not `createdAt`: a draft order waits for
 * the note to be signed, which is not lab time (the TAT job uses `orderedAt` too).
 */

export interface LabTatRow {
  code: string;
  name: string;
  turnaroundHours: number | null;
  count: number;
  medianHours: number | null;
  p90Hours: number | null;
  averageHours: number | null;
  overdue: number;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export async function labTurnaround(r: ClinicRange): Promise<{
  rows: LabTatRow[];
  overall: Omit<LabTatRow, 'code' | 'name' | 'turnaroundHours'>;
}> {
  const groups = await LabOrder.aggregate<{
    _id: string;
    name: string;
    turnaroundHours: number | null;
    hours: number[];
  }>([
    { $match: { ...inRange('releasedAt', r), orderedAt: { $type: 'date' } } },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'cancelled' } } },
    {
      $group: {
        _id: '$items.testSnapshot.code',
        name: { $first: '$items.testSnapshot.name' },
        turnaroundHours: { $max: '$items.testSnapshot.turnaroundHours' },
        hours: { $push: { $divide: [{ $subtract: ['$releasedAt', '$orderedAt'] }, 3_600_000] } },
      },
    },
    { $sort: { name: 1 } },
  ]);
  const stats = (hours: number[], limit: number | null) => ({
    count: hours.length,
    medianHours: round1(percentile(hours, 50)),
    p90Hours: round1(percentile(hours, 90)),
    averageHours: round1(hours.length ? hours.reduce((s, h) => s + h, 0) / hours.length : null),
    overdue: limit ? hours.filter((h) => h > limit).length : 0,
  });
  const rows = groups.map((g) => ({
    code: g._id,
    name: g.name,
    turnaroundHours: g.turnaroundHours ?? null,
    ...stats(g.hours, g.turnaroundHours ?? null),
  }));
  const all = groups.flatMap((g) => g.hours);
  return {
    rows,
    overall: { ...stats(all, null), overdue: rows.reduce((s, x) => s + x.overdue, 0) },
  };
}
