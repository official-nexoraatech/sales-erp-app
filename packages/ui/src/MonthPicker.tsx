import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, type InputVariants } from './inputVariants.js';
import { usePopoverPosition } from './usePopoverPosition.js';

export interface MonthPickerProps {
  /** 'YYYY-MM' */
  value: string | null;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  size?: InputVariants['size'];
  placeholder?: string;
  wrapperClassName?: string;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function parse(value: string | null): { year: number; month: number } | null {
  if (!value) return null;
  const [y, m] = value.split('-').map(Number);
  return { year: y!, month: (m ?? 1) - 1 };
}

/** Same popover shell as DatePicker, a 12-month grid instead of a day grid. */
export default function MonthPicker({
  value,
  onChange,
  label,
  error,
  hint,
  disabled,
  required,
  size = 'md',
  placeholder = 'Select month…',
  wrapperClassName = '',
}: MonthPickerProps) {
  const uid = useId();
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const [viewYear, setViewYear] = useState(() => selected?.year ?? new Date().getFullYear());

  const { triggerRef, panelRef, style } = usePopoverPosition<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
  });

  function select(monthIndex: number) {
    onChange(`${viewYear}-${String(monthIndex + 1).padStart(2, '0')}`);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const displayValue = selected
    ? new Date(selected.year, selected.month, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : '';
  const today = new Date();

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label className="text-sm font-medium text-primary tracking-[-0.01em]">
          {label}
          {required && (
            <span className="text-danger ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div ref={triggerRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errId : hint ? hintId : undefined}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            inputVariants({ size, variant: 'default', state: error ? 'error' : 'default' }),
            'flex items-center justify-between text-left',
            !displayValue && 'text-placeholder'
          )}
        >
          <span className="truncate">{displayValue || placeholder}</span>
          <Calendar size={16} className="shrink-0 text-secondary" aria-hidden="true" />
        </button>

        {open &&
          createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Choose month"
              style={style}
              className="z-[var(--z-popover)] w-64 rounded-md border border-default bg-surface-overlay p-3 shadow-token-lg"
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous year"
                  onClick={() => setViewYear((y) => y - 1)}
                  className="rounded-md p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold text-primary">{viewYear}</span>
                <button
                  type="button"
                  aria-label="Next year"
                  onClick={() => setViewYear((y) => y + 1)}
                  className="rounded-md p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_LABELS.map((m, i) => {
                  const isSelected = selected?.year === viewYear && selected.month === i;
                  const isCurrent = today.getFullYear() === viewYear && today.getMonth() === i;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => select(i)}
                      className={cn(
                        'rounded-md py-2 text-sm transition-colors duration-150 ease-out',
                        isSelected
                          ? 'bg-brand text-primary-fg font-semibold hover:bg-primary-hover'
                          : 'text-primary hover:bg-surface-subtle',
                        isCurrent && !isSelected && 'border border-focus'
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )}
      </div>

      {error && (
        <p id={errId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={hintId} className="text-xs text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}
