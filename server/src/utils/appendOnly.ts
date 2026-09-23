import type { Schema } from 'mongoose';
import { ERROR_CODES } from '../config/constants.js';
import { ApiError } from './ApiError.js';

/** Query-only write operations. updateOne/deleteOne are both query and document middleware. */
const QUERY_ONLY_WRITE_OPS = [
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteMany',
  'findOneAndDelete',
] as const;

/**
 * Makes a collection append-only through Mongoose (spec §10.5): documents can be inserted with
 * `save()` / `create()`, but every update, replace and delete – query, document or bulk – throws
 * 409 RECORD_LOCKED. Raw driver calls (`Model.collection.*`) bypass this by design (tests only).
 */
export function applyAppendOnly(schema: Schema, label: string): void {
  const fail = () => {
    throw new ApiError(409, `${label} are append-only`, ERROR_CODES.RECORD_LOCKED);
  };

  schema.pre([...QUERY_ONLY_WRITE_OPS], fail);
  schema.pre(['updateOne', 'deleteOne'], { document: true, query: true }, fail);
  schema.pre('save', function () {
    if (!this.isNew) fail();
  });
  // Bulk inserts would skip the service (and so the hash chain); bulk writes can update/delete.
  schema.pre('insertMany', fail);
  schema.pre('bulkWrite', fail);
}
