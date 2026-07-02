/** Options for data fetches that may run in the background (e.g. socket-driven). */
export type FetchOptions = {
  /** When true, skip loading gates and update data in place. */
  background?: boolean;
};

/**
 * Returns a debounced version of `fn` that collapses rapid calls (e.g. burst of socket events).
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Shallow compare selected keys on two objects. */
export function shallowEqual<T extends object>(
  a: T | null | undefined,
  b: T | null | undefined,
  keys: (keyof T)[]
): boolean {
  if (!a || !b) return a === b;
  return keys.every((k) => a[k] === b[k]);
}

/** Merge arrays by `id`: update existing items, append new ones, preserve server order. */
export function mergeById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  if (prev.length === 0) return next;
  if (next.length === 0) return prev;

  const prevById = new Map(prev.map((item) => [item.id, item]));
  const nextIds = new Set(next.map((item) => item.id));
  let changed = prev.length !== next.length;

  const merged = next.map((item) => {
    const existing = prevById.get(item.id);
    if (!existing) {
      changed = true;
      return item;
    }
    if (existing === item) return existing;
    changed = true;
    return item;
  });

  if (!changed) {
    for (const item of prev) {
      if (!nextIds.has(item.id)) {
        changed = true;
        break;
      }
    }
  }

  return changed ? merged : prev;
}

/** Prepend items not already present (newest-first lists). */
export function prependById<T extends { id: string }>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const existing = new Set(prev.map((item) => item.id));
  const novel = incoming.filter((item) => !existing.has(item.id));
  if (novel.length === 0) return prev;
  return [...novel, ...prev];
}

/** Call setState only when merged result differs from previous. */
export function applyIfChanged<T>(
  setState: (value: T) => void,
  next: T,
  prev: T,
  isEqual: (a: T, b: T) => boolean = Object.is
): void {
  if (isEqual(prev, next)) return;
  setState(next);
}

/** Merge job patch into existing job; return prev if nothing changed. */
export function mergeJobPatch<T extends object>(prev: T | null, patch: Partial<T>): T | null {
  if (!prev) return prev;
  let changed = false;
  const merged = { ...prev } as T;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] !== undefined && patch[key] !== prev[key]) {
      merged[key] = patch[key] as T[keyof T];
      changed = true;
    }
  }
  return changed ? merged : prev;
}
