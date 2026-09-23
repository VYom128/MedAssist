import type { Types } from 'mongoose';
import type { LabTestDoc } from './model.js';

export type LabTestLike = LabTestDoc & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

const clean = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

/** Patients (spec §2.4: name and price; plus what they need to prepare for the test). */
export function toPatientView(t: LabTestLike) {
  return {
    id: t._id.toString(),
    code: t.code,
    name: t.name,
    category: t.category,
    sampleType: t.sampleType,
    pricePaise: t.pricePaise,
    preparation: t.preparation ?? null,
  };
}

/** Staff: the full catalogue entry with parameters and reference ranges. */
export function toStaffView(t: LabTestLike) {
  return {
    ...toPatientView(t),
    turnaroundHours: t.turnaroundHours ?? null,
    parameters: t.parameters.map((p) => ({
      key: p.key,
      name: p.name,
      unit: p.unit ?? null,
      valueType: p.valueType,
      options: [...p.options],
      ranges: p.ranges.map((r) => clean({ ...r })),
    })),
  };
}

/** Admin: adds status and timestamps. */
export function toAdminView(t: LabTestLike) {
  return {
    ...toStaffView(t),
    isActive: t.isActive,
    createdAt: t.createdAt ?? null,
    updatedAt: t.updatedAt ?? null,
  };
}
