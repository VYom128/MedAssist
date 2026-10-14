import type { Types } from 'mongoose';
import type { AuditLogDoc } from './model.js';

type AuditLike = AuditLogDoc & { _id: Types.ObjectId };

/**
 * Admin view of an audit entry (the only role that can read audit logs). `names` are the actors'
 * current names (`actorNames`); entries written before D206 may still carry a stored name.
 */
export function toAuditView(e: AuditLike, names: Map<string, string> = new Map()) {
  const user = e.actor?.user?.toString() ?? null;
  return {
    id: e._id.toString(),
    seq: e.seq,
    at: e.at,
    actor: {
      user,
      role: e.actor?.role ?? null,
      name: (user ? names.get(user) : undefined) ?? e.actor?.name ?? null,
    },
    action: e.action,
    resource: e.resource?.type
      ? {
          type: e.resource.type,
          id: e.resource.id?.toString() ?? null,
          number: e.resource.number ?? null,
        }
      : null,
    patient: e.patient?.toString() ?? null,
    outcome: e.outcome,
    request: e.request ?? null,
    changes: e.changes?.fields ? e.changes : null,
    metadata: e.metadata ?? null,
    prevHash: e.prevHash,
    hash: e.hash,
  };
}
