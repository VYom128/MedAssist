import type { FilterQuery } from 'mongoose';
import { AUDIT_ACTIONS, ERROR_CODES, ROLES } from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { containsRegex } from '../../utils/regex.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { LabTest, type LabTestDoc } from './model.js';
import { toAdminView, toPatientView, toStaffView, type LabTestLike } from './serializer.js';
import type { CreateLabTestInput, ListLabTestsQuery, UpdateLabTestInput } from './validation.js';

const isAdmin = (viewer: AuthUser) => viewer.role === ROLES.ADMIN;
/** Patients see name and price; staff the full entry; admins also status (spec §2.4). */
const viewFor = (viewer: AuthUser) =>
  isAdmin(viewer) ? toAdminView : viewer.role === ROLES.PATIENT ? toPatientView : toStaffView;

const invalidTransition = (message: string) =>
  new ApiError(409, message, ERROR_CODES.INVALID_STATUS_TRANSITION);

async function findLabTest(id: string): Promise<LabTestLike> {
  const t = (await LabTest.findById(id).lean()) as LabTestLike | null;
  if (!t) throw ApiError.notFound('Lab test not found');
  return t;
}

async function assertCodeFree(code: string, exceptId?: string) {
  const others = exceptId ? { _id: { $ne: exceptId } } : {};
  if (await LabTest.exists({ ...others, code })) {
    throw ApiError.conflict('A lab test with this code already exists', { fields: ['code'] });
  }
}

/** GET /lab-tests – any logged-in user; active only unless an admin passes includeInactive. */
export async function listLabTests(
  viewer: AuthUser,
  query: ListLabTestsQuery,
  { page, limit, skip }: Pagination,
) {
  const filter: FilterQuery<LabTestDoc> = {};
  if (!(isAdmin(viewer) && query.includeInactive)) filter.isActive = true;
  if (query.category) filter.category = query.category;
  if (query.q) filter.$or = [{ name: containsRegex(query.q) }, { code: containsRegex(query.q) }];
  const [items, total] = await Promise.all([
    LabTest.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    LabTest.countDocuments(filter),
  ]);
  const view = viewFor(viewer);
  return {
    items: items.map((t) => view(t as LabTestLike)),
    meta: buildMeta({ page, limit, total }),
  };
}

/** GET /lab-tests/:id – inactive tests are 404 except for admins. */
export async function getLabTest(viewer: AuthUser, id: string) {
  const t = await findLabTest(id);
  if (!t.isActive && !isAdmin(viewer)) throw ApiError.notFound('Lab test not found');
  return viewFor(viewer)(t);
}

export async function createLabTest(admin: AuthUser, input: CreateLabTestInput, meta: RequestMeta) {
  await assertCodeFree(input.code);
  const created = await LabTest.create({ ...input, createdBy: admin.id, updatedBy: admin.id });
  await audit.record({
    action: AUDIT_ACTIONS.LAB_TEST_CREATE,
    actor: actorOf(admin),
    resource: { type: 'lab_test', id: created._id, number: created.code },
    request: meta,
    metadata: {
      name: created.name,
      pricePaise: created.pricePaise,
      parameters: created.parameters.length,
    },
  });
  return toAdminView(created.toObject() as LabTestLike);
}

/** PATCH /lab-tests/:id – audited with before/after of the changed fields. */
export async function updateLabTest(
  admin: AuthUser,
  id: string,
  input: UpdateLabTestInput,
  meta: RequestMeta,
) {
  const before = await findLabTest(id);
  const beforeValues = {
    ...toStaffView(before),
    turnaroundHours: before.turnaroundHours ?? null,
  } as Record<string, unknown>;
  const afterValues = { ...beforeValues, ...input };
  const changes = audit.diffChanges(
    JSON.parse(JSON.stringify(beforeValues)),
    JSON.parse(JSON.stringify(afterValues)),
    Object.keys(input),
  );
  if (changes.fields.length === 0) return toAdminView(before);
  if (changes.fields.includes('code')) await assertCodeFree(input.code!, id);

  const updated = (await LabTest.findByIdAndUpdate(
    id,
    { $set: { ...input, updatedBy: admin.id } },
    { new: true, runValidators: true },
  ).lean()) as LabTestLike;
  await audit.record({
    action: AUDIT_ACTIONS.LAB_TEST_UPDATE,
    actor: actorOf(admin),
    resource: { type: 'lab_test', id, number: updated.code },
    request: meta,
    changes,
  });
  return toAdminView(updated);
}

export async function setLabTestActive(
  admin: AuthUser,
  id: string,
  isActive: boolean,
  meta: RequestMeta,
) {
  const updated = (await LabTest.findOneAndUpdate(
    { _id: id, isActive: !isActive },
    { $set: { isActive, updatedBy: admin.id } },
    { new: true },
  ).lean()) as LabTestLike | null;
  if (!updated) {
    await findLabTest(id); // 404 if missing
    throw invalidTransition(`Lab test is already ${isActive ? 'active' : 'inactive'}`);
  }
  await audit.record({
    action: isActive ? AUDIT_ACTIONS.LAB_TEST_ACTIVATE : AUDIT_ACTIONS.LAB_TEST_DEACTIVATE,
    actor: actorOf(admin),
    resource: { type: 'lab_test', id, number: updated.code },
    request: meta,
    changes: audit.diffChanges({ isActive: !isActive }, { isActive }, ['isActive']),
  });
  return toAdminView(updated);
}
