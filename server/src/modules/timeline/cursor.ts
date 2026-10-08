import { Types } from 'mongoose';
import { TIMELINE_TYPES, type TimelineType } from '../../config/constants.js';

/**
 * Timeline cursors (Phase 8 decision): the position of the last item of a page, as an opaque
 * base64url string of `<at ISO>|<type>|<id>`. Items are ordered by the tuple (at, type, id),
 * newest first; the next page holds the items strictly after the cursor in that order, so items
 * with the same time are never skipped or repeated.
 */
export interface Cursor {
  at: Date;
  type: TimelineType;
  id: Types.ObjectId;
}

export function encodeCursor({ at, type, id }: { at: Date; type: string; id: string }): string {
  return Buffer.from(`${at.toISOString()}|${type}|${id}`, 'utf8').toString('base64url');
}

/** The cursor in `value`, or null if it is not one this server made. */
export function decodeCursor(value: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) return null;
  const [iso, type, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (rest.length > 0 || !iso || !type || !id) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== iso) return null;
  if (!(TIMELINE_TYPES as readonly string[]).includes(type)) return null;
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return { at, type: type as TimelineType, id: new Types.ObjectId(id) };
}

/** Sorts newest first: (at, type, id) descending – the order the cursor filter assumes. */
export function compareDesc(
  a: { at: Date; type: string; id: string },
  b: { at: Date; type: string; id: string },
): number {
  const byTime = b.at.getTime() - a.at.getTime();
  if (byTime !== 0) return byTime;
  if (a.type !== b.type) return a.type < b.type ? 1 : -1;
  // ObjectId hex strings have a fixed length, so string order is byte order (Mongo's order).
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The Mongo condition for "after the cursor" on a source of `type` whose time is `field`:
 * a type sorting before the cursor's keeps items at the cursor's time, one sorting after drops
 * them, the same type compares the id.
 */
export function afterCursor(field: string, type: TimelineType, c: Cursor) {
  if (type < c.type) return { [field]: { $lte: c.at } };
  if (type > c.type) return { [field]: { $lt: c.at } };
  return { $or: [{ [field]: { $lt: c.at } }, { [field]: c.at, _id: { $lt: c.id } }] };
}
