import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `work` in a MongoDB transaction (spec §3.7: multi-document writes). The driver retries
 * the whole callback on transient errors, so `work` must only touch the database through
 * `session` and have no other side effects. Send emails and write audit entries after this
 * resolves (the transaction has committed by then).
 * Needs a replica set (tests use an in-memory one; see README for local MongoDB).
 */
export async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
