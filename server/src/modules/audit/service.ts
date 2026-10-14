import type { FilterQuery } from 'mongoose';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { User } from '../users/model.js';
import { AuditLog, type AuditLogDoc } from './model.js';
import type { AuditLogQuery } from './validation.js';

/**
 * Lists audit entries, newest first, with the §7.18 filters.
 * @param query Validated filters (`actor`, `action`, `resourceType`, `patient`, `outcome`, `from`, `to`).
 */
export async function listAuditLogs(query: AuditLogQuery, { page, limit, skip }: Pagination) {
  const filter: FilterQuery<AuditLogDoc> = {};
  if (query.actor) filter['actor.user'] = query.actor;
  if (query.action) filter.action = { $regex: `^${query.action.replace(/\./g, '\\.')}` };
  if (query.resourceType) filter['resource.type'] = query.resourceType;
  if (query.patient) filter.patient = query.patient;
  if (query.outcome) filter.outcome = query.outcome;
  if (query.from || query.to) {
    filter.at = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: buildMeta({ page, limit, total }) };
}

/**
 * Display names of the users who acted in `entries`, looked up now (D206): entries store the
 * actor's id and role only. Users that no longer exist are left out (the entry shows the role).
 */
export async function actorNames(
  entries: { actor?: { user?: unknown } | null }[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(entries.map((e) => e.actor?.user?.toString()).filter((id): id is string => !!id)),
  ];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } })
    .select('firstName lastName')
    .lean();
  return new Map(users.map((u) => [u._id.toString(), `${u.firstName} ${u.lastName}`]));
}
