import type { ReactNode } from 'react';

interface Props {
  /** The search box, always leftmost — per ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md Part 5. */
  search?: ReactNode;
  /** Status chips, date range, or other quick filters, in composition order. */
  children?: ReactNode;
  /** Right-aligned actions (export, column visibility, density, etc.). */
  actions?: ReactNode;
  className?: string;
}

/** Standardizes the Filter Bar region of a list Workspace (search → quick filters →
 * overflow actions) per ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md Part 2/5. Layout only — it
 * doesn't own filter state, callers still manage their own `useState`/`useDebounce`. */
export default function FilterBar({ search, children, actions, className = '' }: Props) {
  return (
    <div className={`flex flex-wrap items-center gap-3 mb-4 ${className}`}>
      {search && <div className="flex-1 min-w-[200px] max-w-sm">{search}</div>}
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
      {actions && <div className="flex items-center gap-2 ml-auto">{actions}</div>}
    </div>
  );
}
