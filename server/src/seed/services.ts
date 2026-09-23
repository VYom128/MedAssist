import { Service } from '../modules/services/model.js';
import * as services from '../modules/services/service.js';
import { createServiceSchema, updateServiceSchema } from '../modules/services/validation.js';
import { changed, counts, SEED_REQUEST, seedActor, type SeedCounts } from './context.js';
import { SERVICES } from './data/clinic.js';
import { departmentIdsByCode } from './departments.js';

/** ~12 billable services, upserted by code through the services service. */
export async function seedServices(): Promise<SeedCounts> {
  const actor = await seedActor();
  const departmentIds = await departmentIdsByCode();
  const result = counts();
  for (const s of SERVICES) {
    const input = {
      ...s,
      department: s.department ? departmentIds.get(s.department)! : null,
      taxRateBps: s.taxRateBps ?? null,
    };
    const existing = await Service.findOne({ code: s.code }).lean();
    if (!existing) {
      await services.createService(actor, createServiceSchema.body.parse(input), SEED_REQUEST);
      result.created += 1;
      continue;
    }
    const id = existing._id.toString();
    const { code: _code, ...fields } = input;
    const after = await services.updateService(
      actor,
      id,
      updateServiceSchema.body.parse(fields),
      SEED_REQUEST,
    );
    let updated = changed(existing, after);
    if (!existing.isActive) {
      await services.activateService(actor, id, SEED_REQUEST);
      updated = true;
    }
    result[updated ? 'updated' : 'unchanged'] += 1;
  }
  return result;
}
