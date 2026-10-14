import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { logger, serializeError } from '../utils/logger.js';

/**
 * `npm run db:indexes` (spec §18): production builds no indexes on boot, so this compares every
 * model's schema indexes with the database and prints, per collection, what would be created and
 * which indexes no schema declares any more. A dry run by default; `-- --apply` creates the
 * missing ones and drops the stale ones (`Model.syncIndexes()`). Run it after each deploy that
 * changes indexes (TTL, unique and partial indexes included) – and once on a new database.
 */

export interface IndexPlan {
  collection: string;
  toCreate: string[];
  toDrop: string[];
}

const describe = (spec: unknown) =>
  JSON.stringify(Array.isArray(spec) ? spec[0] : spec).replace(/"/g, '');

/** The differences between every registered model's indexes and the database. */
export async function planIndexes(): Promise<IndexPlan[]> {
  const plans: IndexPlan[] = [];
  for (const name of mongoose.modelNames().sort()) {
    const model = mongoose.model(name);
    // A collection that does not exist yet has no indexes: everything is to create.
    const exists =
      (await model.db.db!.listCollections({ name: model.collection.collectionName }).toArray())
        .length > 0;
    const diff = exists
      ? await model.diffIndexes()
      : { toCreate: model.schema.indexes().map((i) => i[0]), toDrop: [] as string[] };
    plans.push({
      collection: model.collection.collectionName,
      toCreate: (diff.toCreate as unknown[]).map(describe),
      toDrop: (diff.toDrop as unknown[]).map(String),
    });
  }
  return plans;
}

/** Applies the plan: creates missing indexes and drops stale ones, model by model. */
export async function applyIndexes(): Promise<void> {
  for (const name of mongoose.modelNames().sort()) await mongoose.model(name).syncIndexes();
}

async function main() {
  const apply = process.argv.includes('--apply');
  createApp(); // registers every model (the routes import them)
  await connectDB();
  try {
    const plans = (await planIndexes()).filter((p) => p.toCreate.length || p.toDrop.length);
    if (plans.length === 0) {
      logger.info('Indexes are up to date');
      return;
    }
    for (const p of plans) {
      logger.info(
        { collection: p.collection, toCreate: p.toCreate, toDrop: p.toDrop },
        'Index changes',
      );
    }
    if (!apply) {
      logger.info('Dry run – nothing changed. Run `npm run db:indexes -- --apply` to apply.');
      return;
    }
    await applyIndexes();
    logger.info({ collections: plans.length }, 'Indexes applied');
  } finally {
    await disconnectDB();
  }
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    logger.fatal({ err: serializeError(err) }, 'Index sync failed');
    process.exit(1);
  });
}
