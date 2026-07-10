import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Syncs filter/sort/pagination state to URL query params — per
 * ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §17: "every state-changing filter/sort/
 * pagination action on a list page must be reflected in the URL, so back/forward genuinely
 * restores prior view state." Uses `replace` (not `push`) so typing in a search box doesn't
 * spam browser history with one entry per keystroke. A param is omitted from the URL
 * entirely when its value equals the default, keeping URLs clean for the common
 * "no filters applied" case.
 *
 * Deliberately ONE hook managing every synced key, not one `useUrlParam(key)` call per key.
 * `useSearchParams`'s setter computes its next value from the `searchParams` it closed over
 * at the last render — two independent per-key hook instances that each call their own
 * setter within the same effect-flush race: the second call's `prev` doesn't see the
 * first's pending update, so the first write is silently discarded. Found this exact bug
 * wiring CustomersPage's search-debounce-sync and page-reset effects, which fired in the
 * same tick and clobbered each other. A single setter that patches multiple keys in one
 * `setSearchParams` call sidesteps the race entirely.
 */
export function useUrlParams<T extends Record<string, string>>(
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const values = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const fromUrl = searchParams.get(key);
    if (fromUrl !== null) values[key as keyof T] = fromUrl as T[keyof T];
  }

  const patch = useCallback(
    (updates: Partial<T>): void => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === undefined || value === defaults[key] || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    // `defaults` is expected to be a stable object literal from the caller (module-level or
    // useMemo'd) — re-created-every-render defaults would otherwise invalidate this callback
    // on every render, which defeats using it inside a dependency array. Intentionally not
    // listed as a dependency for that reason.
    [setSearchParams],
  );

  return [values, patch];
}

/** Numeric read helper — URL params are always strings; parse at the read site. */
export function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
