import type { FilterQuery, Types } from 'mongoose';
import { AUDIT_ACTIONS, ERROR_CODES, ROLES } from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { containsRegex } from '../../utils/regex.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { Department } from '../departments/model.js';
import { assertActiveDepartment } from '../departments/service.js';
import { Service, type ServiceDoc } from './model.js';
import { toAdminView, toPublicView, type ServiceLike } from './serializer.js';
import type { CreateServiceInput, ListServicesQuery, UpdateServiceInput } from './validation.js';

const DEPARTMENT_FIELDS = 'name code isActive';

const isAdmin = (viewer?: AuthUser) => viewer?.role === ROLES.ADMIN;
const viewFor = (viewer?: AuthUser) => (isAdmin(viewer) ? toAdminView : toPublicView);

const invalidTransition = (message: string) =>
  new ApiError(409, message, ERROR_CODES.INVALID_STATUS_TRANSITION);

type Populated = ServiceLike & {
  department?: (ServiceLike['department'] & { isActive?: boolean }) | null;
};

async function findService(id: string): Promise<Populated> {
  const s = (await Service.findById(id)
    .populate('department', DEPARTMENT_FIELDS)
    .lean()) as Populated | null;
  if (!s) throw ApiError.notFound('Service not found');
  return s;
}

/** Plain values for audit diffs (department as an id string). */
const auditValues = (s: Populated) => ({
  ...s,
  department: s.department?._id.toString() ?? null,
  taxRateBps: s.taxRateBps ?? null,
});

async function assertCodeFree(code: string, exceptId?: string) {
  const others = exceptId ? { _id: { $ne: exceptId } } : {};
  if (await Service.exists({ ...others, code })) {
    throw ApiError.conflict('A service with this code already exists', { fields: ['code'] });
  }
}

/**
 * GET /services – filters `department`, `type`, `q`. Everyone except admins with
 * `includeInactive=true` sees only active services outside inactive departments.
 */
export async function listServices(
  viewer: AuthUser | undefined,
  query: ListServicesQuery,
  { page, limit, skip }: Pagination,
) {
  const filter: FilterQuery<ServiceDoc> = {};
  if (query.type) filter.type = query.type;
  if (query.q) filter.$or = [{ name: containsRegex(query.q) }, { code: containsRegex(query.q) }];
  if (!(isAdmin(viewer) && query.includeInactive)) {
    filter.isActive = true;
    const inactive = await Department.find({ isActive: false }, { _id: 1 }).lean();
    if (inactive.length > 0) filter.department = { $nin: inactive.map((d) => d._id) };
  }
  // An explicit department filter narrows further (an inactive one then matches nothing).
  if (query.department) {
    filter.department =
      filter.department === undefined
        ? query.department
        : { ...(filter.department as object), $eq: query.department };
  }
  const [items, total] = await Promise.all([
    Service.find(filter)
      .sort({ type: 1, name: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .populate('department', DEPARTMENT_FIELDS)
      .lean(),
    Service.countDocuments(filter),
  ]);
  const view = viewFor(viewer);
  return {
    items: items.map((s) => view(s as unknown as ServiceLike)),
    meta: buildMeta({ page, limit, total }),
  };
}

/** GET /services/:id – inactive services (or in an inactive department) are 404 except for admins. */
export async function getService(viewer: AuthUser | undefined, id: string) {
  const s = await findService(id);
  const visible = s.isActive && (!s.department || s.department.isActive !== false);
  if (!visible && !isAdmin(viewer)) throw ApiError.notFound('Service not found');
  return viewFor(viewer)(s);
}

export async function createService(admin: AuthUser, input: CreateServiceInput, meta: RequestMeta) {
  await assertCodeFree(input.code);
  if (input.department) await assertActiveDepartment(input.department);
  const created = await Service.create({ ...input, createdBy: admin.id, updatedBy: admin.id });
  await audit.record({
    action: AUDIT_ACTIONS.SERVICE_CREATE,
    actor: actorOf(admin),
    resource: { type: 'service', id: created._id, number: created.code },
    request: meta,
    metadata: { name: created.name, type: created.type, pricePaise: created.pricePaise },
  });
  return toAdminView(await findService(created._id.toString()));
}

/** PATCH /services/:id – audited with before/after of changed fields (price included). */
export async function updateService(
  admin: AuthUser,
  id: string,
  input: UpdateServiceInput,
  meta: RequestMeta,
) {
  const before = await findService(id);
  const beforeValues = auditValues(before);
  const changes = audit.diffChanges(
    beforeValues,
    { ...beforeValues, ...input },
    Object.keys(input),
  );
  if (changes.fields.length === 0) return toAdminView(before);
  if (changes.fields.includes('code')) await assertCodeFree(input.code!, id);
  if (changes.fields.includes('department') && input.department) {
    await assertActiveDepartment(input.department);
  }
  await Service.updateOne(
    { _id: id },
    { $set: { ...input, updatedBy: admin.id } },
    { runValidators: true },
  );
  const updated = await findService(id);
  await audit.record({
    action: AUDIT_ACTIONS.SERVICE_UPDATE,
    actor: actorOf(admin),
    resource: { type: 'service', id, number: updated.code },
    request: meta,
    changes,
  });
  return toAdminView(updated);
}

export async function deactivateService(admin: AuthUser, id: string, meta: RequestMeta) {
  return setActive(admin, id, false, meta);
}

/** Activating needs the service's department (if any) to be active. */
export async function activateService(admin: AuthUser, id: string, meta: RequestMeta) {
  const s = await findService(id);
  if (!s.isActive && s.department) {
    await assertActiveDepartment(s.department._id as Types.ObjectId, 'department');
  }
  return setActive(admin, id, true, meta);
}

async function setActive(admin: AuthUser, id: string, isActive: boolean, meta: RequestMeta) {
  const res = await Service.updateOne(
    { _id: id, isActive: !isActive },
    { $set: { isActive, updatedBy: admin.id } },
  );
  if (res.matchedCount === 0) {
    await findService(id); // 404 if missing
    throw invalidTransition(`Service is already ${isActive ? 'active' : 'inactive'}`);
  }
  const updated = await findService(id);
  await audit.record({
    action: isActive ? AUDIT_ACTIONS.SERVICE_ACTIVATE : AUDIT_ACTIONS.SERVICE_DEACTIVATE,
    actor: actorOf(admin),
    resource: { type: 'service', id, number: updated.code },
    request: meta,
    changes: audit.diffChanges({ isActive: !isActive }, { isActive }, ['isActive']),
  });
  return toAdminView(updated);
}
