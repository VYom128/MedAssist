import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import {
  AUDIT_GENESIS_HASH,
  AUDIT_READ_DEBOUNCE_MS,
  type AuditAction,
  type AuditOutcome,
} from '../config/constants.js';
import { config } from '../config/env.js';
import { AuditLog, type AuditLogDoc } from '../modules/audit/model.js';
import { canonicalJson } from '../utils/canonicalJson.js';
import { logger, serializeError } from '../utils/logger.js';
import {
  actorFromRequest,
  buildRequestMeta,
  type AuditActor,
  type RequestMeta,
} from '../utils/requestContext.js';

type Id = string | { toString(): string };

export interface AuditChanges {
  fields: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AuditEntryInput {
  action: AuditAction;
  /** The request: supplies `request` info and, unless `actor` is given, the actor (`req.user`). */
  req?: Request;
  /** Who did it. Defaults to `req.user`; `null` (or no user) = system job or anonymous caller. */
  actor?: Partial<AuditActor> | null;
  resource?: { type: string; id?: Id | null; number?: string };
  /** Set whenever the action concerns a patient. */
  patient?: Id | null;
  outcome?: AuditOutcome;
  /** Request info for callers without `req` (services receive it from the controller). */
  request?: RequestMeta;
  /** Changed fields with before/after values (see diffChanges). Secret-looking keys are redacted. */
  changes?: AuditChanges;
  /** Extra context (reason, flags). Never clinical content. Secret-looking keys are redacted. */
  metadata?: Record<string, unknown>;
}

export type AuditEntry = AuditLogDoc & { _id: unknown };

// ---- Redaction -----------------------------------------------------------------------------

export const REDACTED = '[REDACTED]';
const SECRET_KEY = /password|token|secret|hash/i;
/** Personal contact details: the audit log records that they changed, not their values. */
const PII_FIELDS = new Set(['email', 'phone']);

/** Replaces the value of every key matching password|token|secret|hash, at any depth. */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redactSecrets(v)]),
    ) as T;
  }
  return value;
}

/**
 * Builds `changes` for an update: only `fields` whose values differ between `before` and `after`,
 * with their old and new values. Contact details (email, phone) are recorded as '[REDACTED]'.
 * @returns `fields: []` when nothing changed.
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): Required<AuditChanges> {
  const changed = fields.filter((f) => canonicalJson(before[f]) !== canonicalJson(after[f]));
  const pick = (src: Record<string, unknown>) =>
    Object.fromEntries(changed.map((f) => [f, PII_FIELDS.has(f) ? REDACTED : src[f]]));
  return { fields: changed, before: pick(before), after: pick(after) };
}

// ---- Hash chain ----------------------------------------------------------------------------

/** Fields covered by the hash, in stored form: the whole entry except `_id` and `hash`. */
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

/** hash = HMAC_SHA256(AUDIT_HASH_SECRET, prevHash + canonicalJSON(entry)) (spec §10.5). */
export function computeHash(entry: Record<string, unknown>): string {
  const hashed: Record<string, unknown> = {};
  for (const key of HASHED_FIELDS) hashed[key] = entry[key];
  return createHmac('sha256', config.audit.hashSecret)
    .update(`${String(entry.prevHash)}${canonicalJson(hashed)}`)
    .digest('hex');
}

export type ChainBreakReason = 'sequence_gap' | 'prev_hash_mismatch' | 'hash_mismatch';

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstBrokenId?: string;
  reason?: ChainBreakReason;
}

/**
 * Re-computes the hash chain in insertion order (`at`, then `_id`) with a cursor (spec §10.5).
 * Reports the first broken entry: edited content (`hash_mismatch`), a re-linked or deleted
 * predecessor (`prev_hash_mismatch`), or a missing sequence number (`sequence_gap`).
 */
export async function verifyChain(): Promise<ChainVerification> {
  let prevHash = AUDIT_GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;

  const cursor = AuditLog.find({}).sort({ at: 1, _id: 1 }).lean().cursor();
  for await (const entry of cursor) {
    checked += 1;
    let reason: ChainBreakReason | undefined;
    if (computeHash(entry as unknown as Record<string, unknown>) !== entry.hash) {
      reason = 'hash_mismatch';
    } else if (entry.prevHash !== prevHash) reason = 'prev_hash_mismatch';
    else if (entry.seq !== expectedSeq) reason = 'sequence_gap';

    if (reason) {
      await cursor.close();
      return { ok: false, checked, firstBrokenId: entry._id.toString(), reason };
    }
    prevHash = entry.hash;
    expectedSeq = entry.seq + 1;
  }
  return { ok: true, checked };
}

// ---- Serialised writer ---------------------------------------------------------------------
// All writes go through one promise chain so two writes in this process never read the same
// prevHash (spec §10.5). The head is read from the database for every write (one indexed query),
// so entries written by another process (the seed, a second API instance, a --reset wipe) are
// picked up instead of chaining onto a stale or deleted entry. If another process takes the same
// `seq` at the same moment, the unique index rejects this write and it is retried on the new head.

let tail: Promise<unknown> = Promise.resolve();
const MAX_WRITE_ATTEMPTS = 3;

async function readHead(): Promise<{ seq: number; hash: string }> {
  const last = await AuditLog.findOne({}, { seq: 1, hash: 1 }).sort({ seq: -1 }).lean();
  return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: AUDIT_GENESIS_HASH };
}

const isSeqConflict = (err: unknown) =>
  (err as { code?: number; keyPattern?: Record<string, unknown> })?.code === 11000 &&
  'seq' in ((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? { seq: 1 });

function toDocument(input: AuditEntryInput, seq: number, prevHash: string) {
  const actor =
    input.actor !== undefined ? input.actor : input.req ? actorFromRequest(input.req) : null;
  const request = input.request ?? (input.req ? buildRequestMeta(input.req) : undefined);
  return new AuditLog({
    seq,
    at: new Date(),
    actor: { user: actor?.user ?? null, role: actor?.role ?? null, name: actor?.name ?? null },
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
    request,
    changes: input.changes ? redactSecrets(input.changes) : undefined,
    metadata: input.metadata ? redactSecrets(input.metadata) : undefined,
    prevHash,
    hash: 'pending',
  });
}

async function write(input: AuditEntryInput): Promise<AuditEntry> {
  for (let attempt = 1; ; attempt += 1) {
    const { seq, hash: prevHash } = await readHead();
    const doc = toDocument(input, seq + 1, prevHash);
    // Hash exactly what will be stored (after Mongoose casting and defaults).
    doc.hash = computeHash(doc.toObject() as Record<string, unknown>);
    try {
      await doc.save();
      return doc.toObject() as AuditEntry;
    } catch (err) {
      if (!isSeqConflict(err) || attempt >= MAX_WRITE_ATTEMPTS) throw err;
    }
  }
}

function enqueue(task: () => Promise<AuditEntry | null>, action: string) {
  const run = tail.then(task).catch((err: unknown) => {
    // Auditing must never break the request. Loud log so failures are noticed.
    logger.error({ err: serializeError(err), action }, 'Audit log write failed');
    return null;
  });
  tail = run;
  return run;
}

/**
 * Appends an audit entry (spec §10.4). Never throws: failures are logged at error level and
 * resolve to null. Awaiting it guarantees the entry is written (or the failure logged).
 * @returns the stored entry, or null if the write failed.
 */
export function record(input: AuditEntryInput): Promise<AuditEntry | null> {
  return enqueue(() => write(input), input.action);
}

/**
 * Records a read, debounced: the same user reading the same resource with the same action within
 * 5 minutes produces one entry (spec §10.4). Needs an actor user and `resource.id`.
 * @returns the new entry, or null if debounced or failed.
 */
export function recordRead(input: AuditEntryInput): Promise<AuditEntry | null> {
  return enqueue(async () => {
    const userId =
      input.actor !== undefined ? input.actor?.user : input.req ? input.req.user?.id : undefined;
    const resourceId = input.resource?.id;
    if (userId && resourceId) {
      const recent = await AuditLog.exists({
        'actor.user': userId,
        action: input.action,
        'resource.id': resourceId,
        at: { $gte: new Date(Date.now() - AUDIT_READ_DEBOUNCE_MS) },
      });
      if (recent) return null;
    }
    return write(input);
  }, input.action);
}

/** Resolves when every queued audit write has finished (graceful shutdown, tests). */
export async function flushAudit(): Promise<void> {
  await tail;
}
