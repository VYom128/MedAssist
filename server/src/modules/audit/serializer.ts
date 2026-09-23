import type { Types } from 'mongoose';
import type { AuditLogDoc } from './model.js';

type AuditLike = AuditLogDoc & { _id: Types.ObjectId };

/** Admin view of an audit entry (the only role that can read audit logs). */
export function toAuditView(e: AuditLike) {
  return {
    id: e._id.toString(),
    seq: e.seq,
    at: e.at,
    actor: {
      user: e.actor?.user?.toString() ?? null,
      role: e.actor?.role ?? null,
      name: e.actor?.name ?? null,
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
