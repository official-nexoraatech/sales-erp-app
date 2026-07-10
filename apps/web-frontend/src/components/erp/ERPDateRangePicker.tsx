import { Calendar } from 'lucide-react';

export interface DateRange {
  from: string;
  to: string;
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

const PRESETS: { label: string; days: number }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shared date-range filter — per ERP-PLANNING/04_ERP_COMPONENT_LIBRARY.md §2. Replaces the
 * bare `<input type="date">` pattern found on report/filter pages (e.g. TrialBalancePage)
 * with one reusable, preset-aware control. */
export default function ERPDateRangePicker({ value, onChange, className = '' }: Props) {
  function applyPreset(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    onChange({ from: isoDate(from), to: isoDate(to) });
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Calendar size={15} className="text-secondary shrink-0" />
      <input
        type="date"
        aria-label="From date"
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className="px-2 py-1.5 text-sm rounded-lg border border-default bg-surface-card text-primary outline-none focus:border-focus focus:ring-2 focus:ring-inset focus:ring-focus"
      />
      <span className="text-secondary text-sm">–</span>
      <input
        type="date"
        aria-label="To date"
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className="px-2 py-1.5 text-sm rounded-lg border border-default bg-surface-card text-primary outline-none focus:border-focus focus:ring-2 focus:ring-inset focus:ring-focus"
      />
      <div className="flex items-center gap-1 ml-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p.days)}
            className="px-2 py-1 text-xs rounded-md text-secondary hover:bg-surface-raised hover:text-primary transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
