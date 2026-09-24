import type { ClientSession } from 'mongoose';
import { Counter } from '../modules/counters/model.js';

/**
 * Human-readable numbers (spec §3.7, §6.27, §8.10). `nextSequence` is one atomic
 * `findOneAndUpdate` with `$inc` + upsert, so parallel callers never get the same number.
 * Inside a transaction, pass its `session`: the number is then only used if the transaction
 * commits (an aborted transaction leaves no gap).
 */

/**
 * Increments and returns the sequence for `key` (1 for a new key).
 * @param key e.g. 'mrn' or 'appointment:2026' (yearly sequences put the year in the key).
 */
export async function nextSequence(
  key: string,
  { session }: { session?: ClientSession } = {},
): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  ).lean();
  return counter!.seq;
}

/**
 * Formats a number per §8.10: `PREFIX-000001`, or `PREFIX-YYYY-000001` when `year` is given.
 * @param pad Digits of the sequence part (default 6).
 */
export function formatNumber(
  prefix: string,
  seq: number,
  { year, pad = 6 }: { year?: number; pad?: number } = {},
): string {
  const digits = String(seq).padStart(pad, '0');
  return year === undefined ? `${prefix}-${digits}` : `${prefix}-${year}-${digits}`;
}

/**
 * Raises the sequence for `key` to at least `value` (never lowers it). The seed uses it after
 * inserting today's queue with tokens, so the next check-in continues from the last token.
 */
export async function ensureSequenceAtLeast(key: string, value: number): Promise<void> {
  await Counter.updateOne({ _id: key }, { $max: { seq: value } }, { upsert: true });
}
