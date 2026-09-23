import { Types, type PipelineStage } from 'mongoose';
import { AUDIT_ACTIONS, DOCTOR_SELF_EDITABLE_FIELDS, ROLES } from '../../config/constants.js';
import { assertCanManageDoctor } from '../../policies/doctorAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { containsRegex } from '../../utils/regex.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { withTransaction } from '../../utils/transaction.js';
import { Department } from '../departments/model.js';
import { assertActiveDepartment } from '../departments/service.js';
import { User } from '../users/model.js';
import { createStaffAccount, sendWelcomeEmail } from '../users/service.js';
import { DoctorProfile } from './model.js';
import { toAdminView, toPublicView, type DoctorLike } from './serializer.js';
import type { CreateDoctorInput, ListDoctorsQuery, UpdateDoctorInput } from './validation.js';

const USER_FIELDS = 'firstName lastName email phone isActive role';
const DEPARTMENT_FIELDS = 'name code';

const isAdmin = (viewer?: AuthUser) => viewer?.role === ROLES.ADMIN;
/** Admins, and a doctor looking at their own profile, get the full view. */
const viewFor = (viewer: AuthUser | undefined, doctorId: string) =>
  isAdmin(viewer) || viewer?.id === doctorId ? toAdminView : toPublicView;

type Loaded = DoctorLike & { user: DoctorLike['user'] & { role: string } };

/**
 * The profile of the doctor whose **User id** is `doctorId`, with user and department populated.
 * @throws 404 if there is no such doctor (or the user has no profile yet).
 */
export async function findDoctor(doctorId: string | Types.ObjectId): Promise<Loaded> {
  const d = (await DoctorProfile.findOne({ user: doctorId })
    .populate('user', USER_FIELDS)
    .populate('department', DEPARTMENT_FIELDS)
    .lean()) as Loaded | null;
  if (!d || !d.user || d.user.role !== ROLES.DOCTOR) throw ApiError.notFound('Doctor not found');
  return d;
}

/**
 * GET /doctors – filters `department`, `specialization` (contains), `q` (name), `accepting=true`.
 * Active doctors only, unless an admin passes `includeInactive=true`. Sorted by last name.
 */
export async function listDoctors(
  viewer: AuthUser | undefined,
  query: ListDoctorsQuery,
  { page, limit, skip }: Pagination,
) {
  const profileMatch: Record<string, unknown> = {};
  if (query.department) profileMatch.department = new Types.ObjectId(query.department);
  if (query.specialization) profileMatch.specialization = containsRegex(query.specialization);
  if (query.accepting !== undefined) profileMatch.isAcceptingAppointments = query.accepting;

  const userMatch: Record<string, unknown> = { 'user.role': ROLES.DOCTOR };
  if (!(isAdmin(viewer) && query.includeInactive)) userMatch['user.isActive'] = true;
  if (query.q) userMatch.fullName = containsRegex(query.q);

  const pipeline: PipelineStage[] = [
    { $match: profileMatch },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'user',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $project: { firstName: 1, lastName: 1, email: 1, phone: 1, isActive: 1, role: 1 } },
        ],
      },
    },
    { $unwind: '$user' },
    { $addFields: { fullName: { $concat: ['$user.firstName', ' ', '$user.lastName'] } } },
    { $match: userMatch },
    {
      $lookup: {
        from: Department.collection.name,
        localField: 'department',
        foreignField: '_id',
        as: 'department',
        pipeline: [{ $project: { name: 1, code: 1 } }],
      },
    },
    { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
    { $sort: { 'user.lastName': 1, 'user.firstName': 1, _id: 1 } },
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
  ];
  const [result] = await DoctorProfile.aggregate<{ items: DoctorLike[]; total: { n: number }[] }>(
    pipeline,
  );
  const view = isAdmin(viewer) ? toAdminView : toPublicView;
  return {
    items: (result?.items ?? []).map((d) => view(d)),
    meta: buildMeta({ page, limit, total: result?.total[0]?.n ?? 0 }),
  };
}

/** GET /doctors/:id – inactive doctors are 404 except for admins. */
export async function getDoctor(viewer: AuthUser | undefined, doctorId: string) {
  const d = await findDoctor(doctorId);
  if (!d.user.isActive && !isAdmin(viewer)) throw ApiError.notFound('Doctor not found');
  return viewFor(viewer, doctorId)(d);
}

/**
 * POST /doctors – creates the doctor's User (temporary password, `mustChangePassword`) and
 * profile in one transaction; if either fails, neither is saved. The welcome email with the
 * "set your password" link is sent only after the commit.
 */
export async function createDoctor(admin: AuthUser, input: CreateDoctorInput, meta: RequestMeta) {
  const { firstName, lastName, email, phone, ...profile } = input;
  await assertActiveDepartment(profile.department);

  const { user, token } = await withTransaction(async (session) => {
    const account = await createStaffAccount(
      admin,
      { firstName, lastName, email, phone, role: ROLES.DOCTOR },
      { session },
    );
    await DoctorProfile.create(
      [{ ...profile, user: account.user._id, createdBy: admin.id, updatedBy: admin.id }],
      { session },
    );
    return account;
  });

  sendWelcomeEmail(user, token);
  await audit.record({
    action: AUDIT_ACTIONS.USER_CREATE,
    actor: actorOf(admin),
    resource: { type: 'user', id: user._id },
    request: meta,
    metadata: { role: ROLES.DOCTOR },
  });
  await audit.record({
    action: AUDIT_ACTIONS.DOCTOR_CREATE,
    actor: actorOf(admin),
    resource: { type: 'doctor', id: user._id },
    request: meta,
    metadata: { department: profile.department, specialization: profile.specialization },
  });
  return toAdminView(await findDoctor(user._id));
}

/** Plain values for audit diffs (department as an id string). */
const auditValues = (d: Loaded): Record<string, unknown> => ({
  ...d,
  department: d.department?._id.toString() ?? null,
  experienceYears: d.experienceYears ?? null,
  consultationFeePaise: d.consultationFeePaise ?? null,
  slotMinutes: d.slotMinutes ?? null,
  roomNumber: d.roomNumber ?? null,
  bio: d.bio ?? null,
});

/**
 * PATCH /doctors/:id – admins change any profile field; a doctor changes only their own `bio` and
 * `languages` (anything else → 403 with `details.fields`).
 */
export async function updateDoctor(
  user: AuthUser,
  doctorId: string,
  input: UpdateDoctorInput,
  meta: RequestMeta,
) {
  await assertCanManageDoctor(user, doctorId, meta);
  if (user.role === ROLES.DOCTOR) {
    const allowed: readonly string[] = DOCTOR_SELF_EDITABLE_FIELDS;
    const fields = Object.keys(input).filter((k) => !allowed.includes(k));
    if (fields.length > 0) {
      throw ApiError.forbidden(
        `Doctors can only change their ${DOCTOR_SELF_EDITABLE_FIELDS.join(' and ')}`,
        { fields },
      );
    }
  }

  const before = await findDoctor(doctorId);
  const beforeValues = auditValues(before);
  const changes = audit.diffChanges(
    beforeValues,
    { ...beforeValues, ...input },
    Object.keys(input),
  );
  if (changes.fields.length === 0) return toAdminView(before);
  if (changes.fields.includes('department')) await assertActiveDepartment(input.department!);

  await DoctorProfile.updateOne(
    { _id: before._id },
    { $set: { ...input, updatedBy: user.id } },
    { runValidators: true },
  );
  await audit.record({
    action: AUDIT_ACTIONS.DOCTOR_UPDATE,
    actor: actorOf(user),
    resource: { type: 'doctor', id: doctorId },
    request: meta,
    changes,
  });
  return toAdminView(await findDoctor(doctorId));
}
