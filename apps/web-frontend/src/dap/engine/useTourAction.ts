import { useEffect, useState } from 'react';
import type { TourStep } from '../content/schema.js';

// Detects whether an interactive step's requiredAction has been satisfied — see
// ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md ADR-5. Returns true immediately for
// informational steps (nothing to wait for). 'route-reached' is trivially satisfied as soon
// as the step is active, since TourProvider already navigates to `step.route` before
// rendering it — the type exists for a future engine mode that doesn't auto-navigate, not
// exercised by DAP-1's pilot content.
export function useTourAction(step: TourStep | null): boolean {
  const [satisfied, setSatisfied] = useState(false);

  useEffect(() => {
    setSatisfied(false);
    if (!step || step.mode !== 'interactive' || !step.requiredAction) {
      setSatisfied(true);
      return;
    }
    const action = step.requiredAction;

    if (action.type === 'route-reached') {
      setSatisfied(true);
      return;
    }

    if (action.type === 'click' && action.selector) {
      const handler = (event: MouseEvent) => {
        const target = event.target as Element | null;
        if (target?.closest(action.selector!)) setSatisfied(true);
      };
      document.addEventListener('click', handler, true);
      return () => document.removeEventListener('click', handler, true);
    }

    if (action.type === 'custom-event' && action.eventName) {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent<{ action?: string }>).detail;
        if (detail?.action === action.eventName) setSatisfied(true);
      };
      window.addEventListener('erp:tour-action', handler);
      return () => window.removeEventListener('erp:tour-action', handler);
    }

    return undefined;
  }, [step]);

  return satisfied;
}
