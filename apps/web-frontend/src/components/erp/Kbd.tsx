/** Shared keyboard-shortcut hint. Per ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §12 —
 * every shortcut hint in the app renders through this, never hand-typed text. */
export default function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-page border border-default text-[10px] font-medium text-disabled">
      {children}
    </kbd>
  );
}
