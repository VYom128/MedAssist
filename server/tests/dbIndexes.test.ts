import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { applyIndexes, planIndexes } from '../src/migrations/indexes.js';
import { Notification } from '../src/modules/notifications/model.js';

/**
 * `npm run db:indexes` (spec §18): production builds no indexes on boot, so the script lists what
 * is missing or stale per collection (dry run) and applies it with `--apply`.
 */
describe('db:indexes', () => {
  beforeAll(async () => {
    createApp(); // registers every model, as the script does
    await applyIndexes();
  }, 120_000);

  it('a fully indexed database needs nothing', async () => {
    const plans = await planIndexes();
    expect(plans.length).toBe(mongoose.modelNames().length);
    expect(plans.filter((p) => p.toCreate.length || p.toDrop.length)).toEqual([]);
  });

  it('lists missing indexes (TTL and unique dedupe included) and stale ones, then applies them', async () => {
    await Notification.collection.dropIndexes();
    await Notification.collection.createIndex({ legacyField: 1 }, { name: 'legacy_1' });

    const plan = (await planIndexes()).find((p) => p.collection === 'notifications')!;
    expect(plan.toDrop).toEqual(['legacy_1']);
    expect(plan.toCreate.join(' ')).toMatch(/createdAt/); // the TTL index
    expect(plan.toCreate.join(' ')).toMatch(/dedupeKey/);

    await applyIndexes();
    const after = (await planIndexes()).find((p) => p.collection === 'notifications')!;
    expect(after).toEqual({ collection: 'notifications', toCreate: [], toDrop: [] });
    const names = (await Notification.collection.indexes()).map((i) => i.name);
    expect(names).not.toContain('legacy_1');
  }, 120_000);
});
