import { useEffect, useState } from 'react';

// Delays reflecting `value` until it's stable for `delayMs` — used to turn the omnibox's
// per-keystroke query state into a debounced react-query queryKey without hammering the
// search endpoint on every character.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
