/**
 * Shared utility helpers used across the backend.
 */

// ── Address normalisation ──────────────────────────────────────────────────────

/**
 * Normalises an address string for consistent storage and fuzzy searching.
 * Lowercases, strips punctuation, and collapses whitespace.
 *
 * Stored in Property.normalizedAddress at create/update time so searches
 * don't need to normalise on every query.
 */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Job number formatting ──────────────────────────────────────────────────────

/**
 * Converts a Job.sequence integer into the PM-visible job number.
 * e.g.  1 → "JOB-0001",  42 → "JOB-0042",  1000 → "JOB-1000"
 */
export function formatJobNumber(sequence: number): string {
  return `JOB-${String(sequence).padStart(4, '0')}`;
}

// ── Pagination ─────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Parses `page` and `limit` from query-string values.
 * Clamps limit to 1–100; page minimum is 1.
 */
export function getPaginationParams(
  query: Record<string, string | string[] | undefined>
): PaginationParams {
  const page = Math.max(1, parseInt((query['page'] as string) ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt((query['limit'] as string) ?? '50', 10) || 50));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Wraps a data array in the standard pagination envelope.
 */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): { data: T[]; meta: { total: number; page: number; limit: number; totalPages: number } } {
  return {
    data,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
