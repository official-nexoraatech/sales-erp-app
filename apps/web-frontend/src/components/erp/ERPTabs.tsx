export interface ERPTabDef {
  key: string;
  label: string;
}

interface Props {
  tabs: ERPTabDef[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/** Shared underline-tab control — per ERP-PLANNING/04_ERP_COMPONENT_LIBRARY.md §10 and
 * ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md §4.5/§4.6. Extracted from 5 near-identical
 * hand-rolled `border-b-2` tab implementations (CustomerViewPage, PurchaseReturnsPage,
 * EmployeeFormPage, AttendancePage, Gstr2aPage) — same visual output, one source. */
export default function ERPTabs({ tabs, active, onChange, className = '' }: Props) {
  return (
    <div role="tablist" className={`flex gap-1 border-b border-default ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.key
              ? 'border-primary text-primary'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
