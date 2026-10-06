import type { UpdateQuery } from 'mongoose';

/**
 * Top-level field names an update touches (`$set: { 'cancellation.at': … }` → cancellation),
 * for immutability hooks. `$setOnInsert` (added by Mongoose timestamps) only applies to inserts,
 * so it is ignored.
 */
export function touchedFields(update: UpdateQuery<unknown>): string[] {
  const fields = new Set<string>();
  for (const [key, value] of Object.entries(update)) {
    if (key === '$setOnInsert') continue;
    if (key.startsWith('$')) {
      for (const path of Object.keys((value ?? {}) as object)) fields.add(path.split('.')[0]!);
    } else {
      fields.add(key.split('.')[0]!);
    }
  }
  return [...fields];
}
