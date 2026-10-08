import { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES, type PatientAccessScope } from '../../config/constants.js';
import { assertCanAccessPatient } from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { loadPatient } from '../patients/service.js';
import { getSettings } from '../settings/service.js';
import { compareDesc, encodeCursor } from './cursor.js';
import { TIMELINE_SOURCES } from './sources/index.js';
import type { TimelineItem, TimelineSource } from './types.js';
import type { TimelineQuery } from './validation.js';

/**
 * The patient scope each role needs for the timeline: doctors a care relationship (clinical),
 * reception any patient. Admins and lab technicians have no timeline (403 by route).
 */
const SCOPE: Partial<Record<string, PatientAccessScope>> = {
  [ROLES.DOCTOR]: 'clinical',
  [ROLES.RECEPTIONIST]: 'demographics',
  [ROLES.PATIENT]: 'demographics',
};

/** The sources `user` may see, narrowed to the requested types. */
export function sourcesFor(
  user: Pick<AuthUser, 'role'>,
  types?: readonly string[],
): TimelineSource[] {
  return TIMELINE_SOURCES.filter(
    (s) => s.rolesAllowed.includes(user.role) && (!types || types.includes(s.type)),
  );
}

/**
 * One page of a patient's timeline (spec §8.8): checks access, asks every source the viewer may
 * see (filtered before merging) for `limit + 1` items after the cursor, merges them newest first,
 * cuts to `limit` and returns the cursor of the last item when more remain. Audited
 * `patient.timeline_view` (debounced 5 min per user + patient).
 */
export async function getTimeline(
  user: AuthUser,
  patientId: string,
  query: TimelineQuery,
  meta: RequestMeta,
) {
  const scope = SCOPE[user.role];
  if (!scope) throw ApiError.forbidden();
  await assertCanAccessPatient(user, patientId, scope, meta);
  const patient = await loadPatient(patientId);

  const { timezone } = await getSettings();
  const limit = query.limit;
  const sourceQuery = {
    viewer: user,
    before: query.before ?? null,
    limit: limit + 1,
    from: query.from ? startOfClinicDay(query.from, timezone) : undefined,
    to: query.to ? endOfClinicDay(query.to, timezone) : undefined,
  };
  const id = new Types.ObjectId(patientId);
  const pages = await Promise.all(
    sourcesFor(user, query.types).map((s) => s.fetch(id, sourceQuery)),
  );
  const merged: TimelineItem[] = pages.flat().sort(compareDesc);
  const items = merged.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = merged.length > limit && last ? encodeCursor(last) : null;

  await audit.recordRead({
    action: AUDIT_ACTIONS.PATIENT_TIMELINE_VIEW,
    actor: actorOf(user),
    resource: { type: 'patient', id: patient._id, number: patient.mrn },
    patient: patient._id,
    request: meta,
  });
  return { items, meta: { limit, nextCursor } };
}

/** GET /patients/me/timeline – the linked patient's own (403 PATIENT_LINK_PENDING if pending). */
export async function getMyTimeline(user: AuthUser, query: TimelineQuery, meta: RequestMeta) {
  return getTimeline(user, await resolveMyPatientId(user), query, meta);
}
