import type { FilterQuery } from 'mongoose';
import { AUDIT_GENESIS_HASH } from '../../config/constants.js';
import { computeHash } from '../../services/audit.service.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { AuditLog, type AuditLogDoc } from './model.js';
import type { AuditLogQuery } from './validation.js';

/**
 * Lists audit entries, newest first, with the §7.18 filters.
 * @param query Validated filters (`actor`, `action`, `resourceType`, `patient`, `outcome`, `from`, `to`).
 */
export async function listAuditLogs(query: AuditLogQuery, { page, limit, skip }: Pagination) {
  const filter: FilterQuery<AuditLogDoc> = {};
  if (query.actor) filter['actor.user'] = query.actor;
  if (query.action) filter.action = query.action;
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
    AuditLog.find(filter).sort({ seq: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: buildMeta({ page, limit, total }) };
}

export type ChainBreakReason = 'sequence_gap' | 'prev_hash_mismatch' | 'hash_mismatch';

export interface ChainVerification {
  valid: boolean;
  checked: number;
  firstBroken: { seq: number; reason: ChainBreakReason } | null;
}

/**
 * Re-computes the hash chain in `seq` order (spec §10.5) and reports the first broken link:
 * a missing entry (`sequence_gap`), a re-linked entry (`prev_hash_mismatch`) or edited
 * content (`hash_mismatch`).
 */
export async function verifyChain(): Promise<ChainVerification> {
  let prevHash = AUDIT_GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;

  const cursor = AuditLog.find({}).sort({ seq: 1 }).lean().cursor();
  for await (const entry of cursor) {
    checked += 1;
    let reason: ChainBreakReason | null = null;
    if (entry.seq !== expectedSeq) reason = 'sequence_gap';
    else if (entry.prevHash !== prevHash) reason = 'prev_hash_mismatch';
    else if (computeHash(entry as unknown as Record<string, unknown>) !== entry.hash) {
      reason = 'hash_mismatch';
    }
    if (reason) {
      await cursor.close();
      return { valid: false, checked, firstBroken: { seq: entry.seq, reason } };
    }
    prevHash = entry.hash;
    expectedSeq = entry.seq + 1;
  }
  return { valid: true, checked, firstBroken: null };
}
