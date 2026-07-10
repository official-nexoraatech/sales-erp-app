import { useEffect } from 'react';

/**
 * Warns before the user leaves a form with unsaved changes — per
 * ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md §4.4 (universal dirty-state warning).
 *
 * Scoped to browser-level navigation (tab close, refresh, typed URL, bookmark) via
 * `beforeunload` only. In-app navigation (clicking a sidebar link, breadcrumb, etc.) is
 * NOT blocked: React Router's `useBlocker` requires a data router
 * (`createBrowserRouter`/`RouterProvider`), and this app runs the declarative
 * `<BrowserRouter>`/`<Routes>` router — migrating routers to add this one guard would be a
 * large, unrelated architectural change, not a form-guard fix. Revisit if the app ever
 * migrates to a data router.
 */
export function useDirtyFormGuard(isDirty: boolean): void {
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
