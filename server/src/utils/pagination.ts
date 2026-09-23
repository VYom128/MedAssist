import type { PaginationMeta } from './ApiResponse.js';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 ? value : fallback;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value);
    return n >= 1 ? n : fallback;
  }
  return fallback;
}

/**
 * Reads `?page` and `?limit` from a query object (spec §7.1).
 * Missing or invalid values fall back to page 1 / limit 20; limit is capped at 100.
 */
export function parsePagination(query: Record<string, unknown> = {}): Pagination {
  const page = toPositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(toPositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

/** Builds the list response `meta`: `{ page, limit, total, totalPages }`. */
export function buildMeta({
  page,
  limit,
  total,
}: {
  page: number;
  limit: number;
  total: number;
}): PaginationMeta {
  return { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
}

export type SortSpec = Record<string, 1 | -1>;

/**
 * Parses `?sort=-createdAt,lastName` (spec §7.1): `-` = descending. Only `allowed` fields are
 * accepted. `_id` is always added last so pages are stable when values tie.
 * @returns the Mongo sort object, or null if a field is not allowed (or the value is malformed).
 */
export function parseSort(
  value: string | undefined,
  allowed: readonly string[],
  fallback: SortSpec,
): SortSpec | null {
  if (value === undefined || value.trim() === '') return { ...fallback, _id: -1 };
  const sort: SortSpec = {};
  for (const raw of value.split(',')) {
    const part = raw.trim();
    const desc = part.startsWith('-');
    const field = desc ? part.slice(1) : part;
    if (!allowed.includes(field) || field in sort) return null;
    sort[field] = desc ? -1 : 1;
  }
  return { ...sort, _id: -1 };
}
