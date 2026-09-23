import type { Types } from 'mongoose';
import type { ServiceDoc } from './model.js';

interface DepartmentRef {
  _id: Types.ObjectId;
  name: string;
  code: string;
}

/** A service with `department` populated (name, code) or null. */
export type ServiceLike = Omit<ServiceDoc, 'department'> & {
  _id: Types.ObjectId;
  department?: DepartmentRef | null;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Anyone (spec §7.5 GET is public). */
export function toPublicView(s: ServiceLike) {
  return {
    id: s._id.toString(),
    code: s.code,
    name: s.name,
    department: s.department
      ? { id: s.department._id.toString(), name: s.department.name, code: s.department.code }
      : null,
    type: s.type,
    durationMinutes: s.durationMinutes,
    pricePaise: s.pricePaise,
    taxRateBps: s.taxRateBps ?? null,
  };
}

/** Admin: adds status and timestamps. */
export function toAdminView(s: ServiceLike) {
  return {
    ...toPublicView(s),
    isActive: s.isActive,
    createdAt: s.createdAt ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}
