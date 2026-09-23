import type { Types } from 'mongoose';
import type { DepartmentDoc } from './model.js';

export type DepartmentLike = DepartmentDoc & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Anyone (spec §7.5 GET is public). */
export function toPublicView(d: DepartmentLike) {
  return {
    id: d._id.toString(),
    name: d.name,
    code: d.code,
    description: d.description ?? null,
  };
}

/** Admin: adds status and timestamps. */
export function toAdminView(d: DepartmentLike) {
  return {
    ...toPublicView(d),
    isActive: d.isActive,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
  };
}
