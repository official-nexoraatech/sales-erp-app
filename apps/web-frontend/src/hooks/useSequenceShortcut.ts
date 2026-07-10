import { useEffect, useRef } from 'react';

const SEQUENCE_WINDOW_MS = 1000;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Gmail/Linear-style two-key "go to" sequence (e.g. `G` then `D`) — per
 * ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §12. The second key must be pressed
 * within `SEQUENCE_WINDOW_MS` of the first, otherwise the sequence resets.
 */
export function useSequenceShortcut(keys: [string, string], callback: () => void): void {
  const [first, second] = keys;
  const lastKeyTime = useRef<number>(0);
  const awaitingSecond = useRef(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const pressed = e.key.toLowerCase();
      const now = Date.now();

      if (awaitingSecond.current && now - lastKeyTime.current <= SEQUENCE_WINDOW_MS) {
        awaitingSecond.current = false;
        if (pressed === second.toLowerCase()) {
          e.preventDefault();
          callback();
          return;
        }
      }

      awaitingSecond.current = pressed === first.toLowerCase();
      lastKeyTime.current = now;
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [first, second, callback]);
}
