import type { FilterQuery, Types } from 'mongoose';
import { AUDIT_ACTIONS, ERROR_CODES, ROLES } from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { containsRegex, exactRegex } from '../../utils/regex.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { DoctorProfile } from '../doctors/model.js';
import { User } from '../users/model.js';
import { Department, type DepartmentDoc } from './model.js';
import { toAdminView, toPublicView, type DepartmentLike } from './serializer.js';
import type {
  CreateDepartmentInput,
  ListDepartmentsQuery,
  UpdateDepartmentInput,
} from './validation.js';

const isAdmin = (viewer?: AuthUser) => viewer?.role === ROLES.ADMIN;

const invalidTransition = (message: string) =>
  new ApiError(409, message, ERROR_CODES.INVALID_STATUS_TRANSITION);

async function findDepartment(id: string | Types.ObjectId): Promise<DepartmentLike> {
  const d = (await Department.findById(id).lean()) as DepartmentLike | null;
  if (!d) throw ApiError.notFound('Department not found');
  return d;
}

/** Active doctors (an active doctor User with a profile) in a department. */
export async function countActiveDoctorsIn(departmentId: string | Types.ObjectId): Promise<number> {
  const userIds = await DoctorProfile.distinct('user', { department: departmentId });
  if (userIds.length === 0) return 0;
  return User.countDocuments({ _id: { $in: userIds }, role: ROLES.DOCTOR, isActive: true });
}

/** Active doctors per department, for the admin list (one aggregate, not one query each). */
async function activeDoctorCounts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await DoctorProfile.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { department: { $in: ids } } },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'user',
        foreignField: '_id',
        as: 'u',
        pipeline: [{ $match: { role: ROLES.DOCTOR, isActive: true } }, { $project: { _id: 1 } }],
      },
    },
    { $match: { 'u.0': { $exists: true } } },
    { $group: { _id: '$department', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/**
 * For services and doctors that reference a department: it must exist and be active.
 * @throws 422 with `details: [{ field, message }]`.
 */
export async function assertActiveDepartment(
  id: string | Types.ObjectId,
  field = 'body.department',
) {
  const d = await Department.findById(id, { isActive: 1 }).lean();
  if (!d || !d.isActive) {
    throw ApiError.unprocessable('Choose an active department', [
      { field, message: d ? 'This department is inactive' : 'Department not found' },
    ]);
  }
}

/** 409 if another department already uses this name (case-insensitive) or code. */
async function assertUnique(input: { name?: string; code?: string }, exceptId?: string) {
  const fields: string[] = [];
  const others = exceptId ? { _id: { $ne: exceptId } } : {};
  if (input.name && (await Department.exists({ ...others, name: exactRegex(input.name) }))) {
    fields.push('name');
  }
  if (input.code && (await Department.exists({ ...others, code: input.code }))) {
    fields.push('code');
  }
  if (fields.length > 0) {
    throw ApiError.conflict(`A department with this ${fields.join(' and ')} already exists`, {
      fields,
    });
  }
}

/** GET /departments – active only, unless an admin asks for inactive ones too. Sorted by name. */
export async function listDepartments(
  viewer: AuthUser | undefined,
  query: ListDepartmentsQuery,
  { page, limit, skip }: Pagination,
) {
  const filter: FilterQuery<DepartmentDoc> = {};
  if (!(isAdmin(viewer) && query.includeInactive)) filter.isActive = true;
  if (query.q) filter.$or = [{ name: containsRegex(query.q) }, { code: containsRegex(query.q) }];
  const [items, total] = await Promise.all([
    Department.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    Department.countDocuments(filter),
  ]);
  if (!isAdmin(viewer)) {
    return {
      items: items.map((d) => toPublicView(d as DepartmentLike)),
      meta: buildMeta({ page, limit, total }),
    };
  }
  const counts = await activeDoctorCounts(items.map((d) => d._id));
  return {
    items: items.map((d) => ({
      ...toAdminView(d as DepartmentLike),
      activeDoctors: counts.get(d._id.toString()) ?? 0,
    })),
    meta: buildMeta({ page, limit, total }),
  };
}

/** GET /departments/:id – inactive departments are only visible to admins (404 otherwise). */
export async function getDepartment(viewer: AuthUser | undefined, id: string) {
  const d = await findDepartment(id);
  if (!isAdmin(viewer)) {
    if (!d.isActive) throw ApiError.notFound('Department not found');
    return toPublicView(d);
  }
  return { ...toAdminView(d), activeDoctors: await countActiveDoctorsIn(d._id) };
}

export async function createDepartment(
  admin: AuthUser,
  input: CreateDepartmentInput,
  meta: RequestMeta,
) {
  await assertUnique(input);
  const created = await Department.create({ ...input, createdBy: admin.id, updatedBy: admin.id });
  await audit.record({
    action: AUDIT_ACTIONS.DEPARTMENT_CREATE,
    actor: actorOf(admin),
    resource: { type: 'department', id: created._id, number: created.code },
    request: meta,
    metadata: { name: created.name, code: created.code },
  });
  return toAdminView(created.toObject() as DepartmentLike);
}

export async function updateDepartment(
  admin: AuthUser,
  id: string,
  input: UpdateDepartmentInput,
  meta: RequestMeta,
) {
  const before = await findDepartment(id);
  const changes = audit.diffChanges(before, { ...before, ...input }, Object.keys(input));
  if (changes.fields.length === 0) return toAdminView(before);
  await assertUnique(
    {
      name: changes.fields.includes('name') ? input.name : undefined,
      code: changes.fields.includes('code') ? input.code : undefined,
    },
    id,
  );
  const updated = (await Department.findByIdAndUpdate(
    id,
    { $set: { ...input, updatedBy: admin.id } },
    { new: true, runValidators: true },
  ).lean()) as DepartmentLike;
  await audit.record({
    action: AUDIT_ACTIONS.DEPARTMENT_UPDATE,
    actor: actorOf(admin),
    resource: { type: 'department', id, number: updated.code },
    request: meta,
    changes,
  });
  return toAdminView(updated);
}

/** Blocked (409 CONFLICT) while active doctors belong to the department (spec §7.5). */
export async function deactivateDepartment(admin: AuthUser, id: string, meta: RequestMeta) {
  const d = await findDepartment(id);
  if (!d.isActive) throw invalidTransition('Department is already inactive');
  const activeDoctors = await countActiveDoctorsIn(id);
  if (activeDoctors > 0) {
    throw ApiError.conflict(
      `This department still has ${activeDoctors} active doctor${activeDoctors === 1 ? '' : 's'}. ` +
        'Move them to another department or deactivate them first.',
      { activeDoctors },
    );
  }
  const updated = (await Department.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false, updatedBy: admin.id } },
    { new: true },
  ).lean()) as DepartmentLike | null;
  if (!updated) throw invalidTransition('Department is already inactive');
  await audit.record({
    action: AUDIT_ACTIONS.DEPARTMENT_DEACTIVATE,
    actor: actorOf(admin),
    resource: { type: 'department', id, number: updated.code },
    request: meta,
    changes: audit.diffChanges({ isActive: true }, { isActive: false }, ['isActive']),
  });
  return toAdminView(updated);
}

export async function activateDepartment(admin: AuthUser, id: string, meta: RequestMeta) {
  const updated = (await Department.findOneAndUpdate(
    { _id: id, isActive: false },
    { $set: { isActive: true, updatedBy: admin.id } },
    { new: true },
  ).lean()) as DepartmentLike | null;
  if (!updated) {
    await findDepartment(id); // 404 if missing
    throw invalidTransition('Department is already active');
  }
  await audit.record({
    action: AUDIT_ACTIONS.DEPARTMENT_ACTIVATE,
    actor: actorOf(admin),
    resource: { type: 'department', id, number: updated.code },
    request: meta,
    changes: audit.diffChanges({ isActive: false }, { isActive: true }, ['isActive']),
  });
  return toAdminView(updated);
}
