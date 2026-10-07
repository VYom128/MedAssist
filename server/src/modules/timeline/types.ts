import type { Types } from 'mongoose';
import type { Role, TimelineType } from '../../config/constants.js';
import type { AuthUser } from '../../types/express.js';
import { afterCursor, type Cursor } from './cursor.js';

/**
 * One timeline entry (spec §8.8). `title`/`subtitle` carry no clinical free text for
 * non-clinical roles; `link` is the client page that opens it (or null).
 */
export interface TimelineItem {
  type: TimelineType;
  id: string;
  at: Date;
  title: string;
  subtitle: string | null;
  status: string | null;
  link: string | null;
  flags: string[];
}

/** What every source is asked for: items after `before`, at most `limit`, in [from, to]. */
export interface SourceQuery {
  viewer: AuthUser;
  before: Cursor | null;
  limit: number;
  from?: Date;
  to?: Date;
}

/**
 * A timeline source (pluggable – Phase 9 adds approved AI summaries). `query` reads the
 * patient's records the viewer may see (newest first, using an index on patient + time field);
 * `toItem` maps one to a timeline item for that viewer.
 */
export interface SourceDefinition<D> {
  type: TimelineType;
  rolesAllowed: readonly Role[];
  query(patientId: Types.ObjectId, q: SourceQuery): Promise<D[]>;
  toItem(doc: D, viewer: AuthUser): TimelineItem;
}

export interface TimelineSource {
  type: TimelineType;
  rolesAllowed: readonly Role[];
  fetch(patientId: Types.ObjectId, q: SourceQuery): Promise<TimelineItem[]>;
}

export function defineSource<D>(def: SourceDefinition<D>): TimelineSource & SourceDefinition<D> {
  return {
    ...def,
    async fetch(patientId, q) {
      const docs = await def.query(patientId, q);
      return docs.map((d) => def.toItem(d, q.viewer));
    },
  };
}

/**
 * The common part of a source's filter: the time field set, inside [from, to], after the
 * cursor. Sort with `newestFirst(field)` and limit with `q.limit`.
 */
export function windowFilter(field: string, type: TimelineType, q: SourceQuery) {
  const range: Record<string, unknown> = { $type: 'date' };
  if (q.from) range.$gte = q.from;
  if (q.to) range.$lte = q.to;
  const and: Record<string, unknown>[] = [{ [field]: range }];
  if (q.before) and.push(afterCursor(field, type, q.before));
  return and;
}

export const newestFirst = (field: string) => ({ [field]: -1 as const, _id: -1 as const });

export interface PersonRef {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

export const doctorName = (d?: PersonRef | null) =>
  d?.firstName ? `Dr ${d.firstName} ${d.lastName ?? ''}`.trim() : 'the doctor';

export const joinParts = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p)).join(' · ') || null;
