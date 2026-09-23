import { createHmac } from 'node:crypto';
import {
  AUDIT_GENESIS_HASH,
  AUDIT_READ_DEBOUNCE_MS,
  type AuditAction,
  type AuditOutcome,
} from '../config/constants.js';
import { config } from '../config/env.js';
import { AuditLog } from '../modules/audit/model.js';
import { canonicalJson } from '../utils/canonicalJson.js';
import { logger, serializeError } from '../utils/logger.js';
import type { AuditActor, RequestMeta } from '../utils/requestContext.js';

type Id = string | { toString(): string };

export interface AuditEntryInput {
  action: AuditAction;
  /** Who did it. Omit (or null user) for system jobs and anonymous callers. */
  actor?: Partial<AuditActor> | null;
  resource?: { type: string; id?: Id | null; number?: string };
  /** Set whenever the action concerns a patient. */
  patient?: Id | null;
  outcome?: AuditOutcome;
  request?: RequestMeta;
  /** Changed field names plus before/after values. Callers must redact sensitive values. */
  changes?: { fields: string[]; before?: Record<string, unknown>; after?: Record<string, unknown> };
  /** Extra context (reason, flags). Never tokens, passwords or clinical content. */
  metadata?: Record<string, unknown>;
}

/** Fields covered by the hash, in stored form. `_id` and `hash` are excluded. */
const HASHED_FIELDS = [
  'seq',
  'at',
  'actor',
  'action',
  'resource',
  'patient',
  'outcome',
  'request',
  'changes',
  'metadata',
  'prevHash',
] as const;

/** hash = HMAC_SHA256(secret, prevHash + canonicalJSON(entry)) (spec §10.5). */
export function computeHash(entry: Record<string, unknown>): string {
  const hashed: Record<string, unknown> = {};
  for (const key of HASHED_FIELDS) hashed[key] = entry[key];
  return createHmac('sha256', config.audit.hashSecret)
    .update(`${String(entry.prevHash)}${canonicalJson(hashed)}`)
    .digest('hex');
}

// ---- Serialised writer ---------------------------------------------------------------------
// All writes go through one promise chain so each entry links to the one before it. This keeps
// the chain linear within one API process (spec §10.5); several instances would need a
// counter + retry instead.

let tail: Promise<void> = Promise.resolve();
let head: { seq: number; hash: string } | null = null;

async function loadHead() {
  if (head) return head;
  const last = await AuditLog.findOne({}, { seq: 1, hash: 1 }).sort({ seq: -1 }).lean();
  head = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: AUDIT_GENESIS_HASH };
  return head;
}

function toDocument(input: AuditEntryInput, seq: number, prevHash: string) {
  return new AuditLog({
    seq,
    at: new Date(),
    actor: {
      user: input.actor?.user ?? null,
      role: input.actor?.role ?? null,
      name: input.actor?.name ?? null,
    },
    action: input.action,
    resource: input.resource
      ? {
          type: input.resource.type,
          id: input.resource.id ?? undefined,
          number: input.resource.number,
        }
      : undefined,
    patient: input.patient ?? undefined,
    outcome: input.outcome ?? 'success',
    request: input.request,
    changes: input.changes,
    metadata: input.metadata,
    prevHash,
    hash: 'pending',
  });
}

async function write(input: AuditEntryInput): Promise<void> {
  const { seq, hash: prevHash } = await loadHead();
  const doc = toDocument(input, seq + 1, prevHash);
  // Hash exactly what will be stored (after Mongoose casting and defaults).
  doc.hash = computeHash(doc.toObject() as Record<string, unknown>);
  try {
    await doc.save();
  } catch (err) {
    head = null; // re-read the real head next time (e.g. another process wrote meanwhile)
    throw err;
  }
  head = { seq: doc.seq, hash: doc.hash };
}

function enqueue(task: () => Promise<void>, action: string): Promise<void> {
  const run = tail.then(task).catch((err: unknown) => {
    // Auditing must never break the request. Loud log so failures are noticed.
    logger.error({ err: serializeError(err), action }, 'Audit log write failed');
  });
  tail = run;
  return run;
}

/**
 * Appends an audit entry. Never rejects: failures are logged at error level. Awaiting it
 * guarantees the entry is written (or the failure logged) before continuing.
 */
export function record(input: AuditEntryInput): Promise<void> {
  return enqueue(() => write(input), input.action);
}

/**
 * Records a read of a record, debounced: the same user reading the same resource with the same
 * action within 5 minutes produces one entry (spec §10.4). Requires `actor.user` and `resource.id`.
 */
export function recordRead(input: AuditEntryInput): Promise<void> {
  return enqueue(async () => {
    const userId = input.actor?.user;
    const resourceId = input.resource?.id;
    if (userId && resourceId) {
      const recent = await AuditLog.exists({
        'actor.user': userId,
        action: input.action,
        'resource.id': resourceId,
        at: { $gte: new Date(Date.now() - AUDIT_READ_DEBOUNCE_MS) },
      });
      if (recent) return;
    }
    await write(input);
  }, input.action);
}

/** Resolves when every queued audit write has finished (graceful shutdown, tests). */
export function flushAudit(): Promise<void> {
  return tail;
}

/** Forgets the cached chain head so the next write re-reads it (tests that wipe the collection). */
export function resetAuditChainCache(): void {
  head = null;
}
