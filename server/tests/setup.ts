// Must run before the app (and config/env.ts) is imported by any test file.
process.env.NODE_ENV = 'test';
// config/env.ts gives tests placeholder secrets and BCRYPT_ROUNDS=4.
process.env.EMAIL_TRANSPORT = 'console';

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';

let replSet: MongoMemoryReplSet | undefined;

/** URI of this test file's in-memory replica set (for tests that reconnect). */
export function getMongoUri(): string {
  if (!replSet) throw new Error('Replica set not started');
  return replSet.getUri();
}

// A 1-member replica set (not a standalone server) so transactions work in later phases.
beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
