import { Department } from '../modules/departments/model.js';
import * as departments from '../modules/departments/service.js';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
} from '../modules/departments/validation.js';
import { changed, counts, SEED_REQUEST, seedActor, type SeedCounts } from './context.js';
import { DEPARTMENTS } from './data/clinic.js';

/** The 5 departments, upserted by code through the departments service; inactive ones reactivated. */
export async function seedDepartments(): Promise<SeedCounts> {
  const actor = await seedActor();
  const result = counts();
  for (const d of DEPARTMENTS) {
    const existing = await Department.findOne({ code: d.code }).lean();
    if (!existing) {
      await departments.createDepartment(actor, createDepartmentSchema.body.parse(d), SEED_REQUEST);
      result.created += 1;
      continue;
    }
    const id = existing._id.toString();
    const { code: _code, ...fields } = d;
    const after = await departments.updateDepartment(
      actor,
      id,
      updateDepartmentSchema.body.parse(fields),
      SEED_REQUEST,
    );
    let updated = changed(existing, after);
    if (!existing.isActive) {
      await departments.activateDepartment(actor, id, SEED_REQUEST);
      updated = true;
    }
    result[updated ? 'updated' : 'unchanged'] += 1;
  }
  return result;
}

/** Department ids by code (for services and doctors). */
export async function departmentIdsByCode(): Promise<Map<string, string>> {
  const all = await Department.find({}, { code: 1 }).lean();
  return new Map(all.map((d) => [d.code, d._id.toString()]));
}
