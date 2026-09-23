import { LabTest } from '../modules/labTests/model.js';
import * as labTests from '../modules/labTests/service.js';
import { createLabTestSchema, updateLabTestSchema } from '../modules/labTests/validation.js';
import { changed, counts, SEED_REQUEST, seedActor, type SeedCounts } from './context.js';
import { LAB_TESTS } from './data/labTests.js';

/** The lab test catalogue, upserted by code through the lab tests service (full validation). */
export async function seedLabTests(): Promise<SeedCounts> {
  const actor = await seedActor();
  const result = counts();
  for (const t of LAB_TESTS) {
    const existing = await LabTest.findOne({ code: t.code }).lean();
    if (!existing) {
      await labTests.createLabTest(actor, createLabTestSchema.body.parse(t), SEED_REQUEST);
      result.created += 1;
      continue;
    }
    const id = existing._id.toString();
    const { code: _code, ...fields } = t;
    const after = await labTests.updateLabTest(
      actor,
      id,
      updateLabTestSchema.body.parse(fields),
      SEED_REQUEST,
    );
    let updated = changed(existing, after);
    if (!existing.isActive) {
      await labTests.setLabTestActive(actor, id, true, SEED_REQUEST);
      updated = true;
    }
    result[updated ? 'updated' : 'unchanged'] += 1;
  }
  return result;
}
