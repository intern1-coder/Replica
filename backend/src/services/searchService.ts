import Fuse from 'fuse.js';

/**
 * Fuzzy-searches a pre-loaded list of items by the given keys.
 * Returns results sorted by Fuse.js score (best match first).
 *
 * Used for client and property lookup to replicate the manual matching
 * workflow from the old MLDB spreadsheet — fast, tolerant of typos.
 *
 * @param items     - In-memory array to search
 * @param query     - User-supplied search string
 * @param keys      - Dot-notation field paths to search within
 * @param threshold - 0 = exact, 1 = match anything. Default 0.4.
 */
export function fuzzySearch<T extends object>(
  items: T[],
  query: string,
  keys: string[],
  threshold = 0.4
): T[] {
  if (!query.trim()) return items;

  const fuse = new Fuse(items, {
    keys,
    threshold,
    includeScore: true,
    ignoreLocation: true,  // score by match quality, not by position in string
    minMatchCharLength: 2,
  });

  return fuse.search(query).map((result) => result.item);
}
