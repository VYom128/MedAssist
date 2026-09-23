/** Duck-types BSON ObjectIds (Mongoose documents and `.lean()` results both use bson's class). */
function isObjectId(value: object): value is { toHexString(): string } {
  return (value as { _bsontype?: unknown })._bsontype === 'ObjectId';
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    if (isObjectId(value)) return value.toHexString();
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Deterministic JSON for hashing: object keys sorted, `undefined` properties dropped,
 * Dates as ISO strings and ObjectIds as hex strings. The same data gives the same string
 * whether it comes from a new document or from `.lean()`.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}
