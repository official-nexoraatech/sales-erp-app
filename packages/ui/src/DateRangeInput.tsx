import { cn } from './cn.js';
import DateInput from './DateInput.js';

export interface DateRange {
  from: string;
  to: string;
}

export interface DateRangeInputProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  size?: 'sm' | 'md';
}

const PRESETS: { label: string; days: number }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Restyled ERPDateRangePicker: two DateInputs plus quick-range preset chips. */
export default function DateRangeInput({
  value,
  onChange,
  className = '',
  size = 'sm',
}: DateRangeInputProps) {
  function applyPreset(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    onChange({ from: isoDate(from), to: isoDate(to) });
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <DateInput
        aria-label="From date"
        size={size}
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        wrapperClassName="w-40"
      />
      <span className="text-secondary text-sm" aria-hidden="true">
        –
      </span>
      <DateInput
        aria-label="To date"
        size={size}
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        wrapperClassName="w-40"
      />
      <div className="ml-1 flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p.days)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-subtle hover:text-primary"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
