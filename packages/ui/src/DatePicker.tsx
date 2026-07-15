import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, type InputVariants } from './inputVariants.js';
import { usePopoverPosition } from './usePopoverPosition.js';
import {
  toISODate,
  parseISODate,
  isSameDay,
  startOfDay,
  buildMonthGrid,
  WEEKDAY_LABELS,
} from './dateGridUtils.js';

export interface DatePickerProps {
  /** ISO date string, 'YYYY-MM-DD'. */
  value: string | null;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  size?: InputVariants['size'];
  placeholder?: string;
  /** ISO date strings — the range of selectable dates (inclusive). */
  minDate?: string;
  maxDate?: string;
  /** Return true to disable a specific date beyond the min/max range. */
  isDateDisabled?: (date: Date) => boolean;
  wrapperClassName?: string;
}

const toISO = toISODate;
const parseISO = parseISODate;

/** Calendar-grid date picker — month/year navigation, Today shortcut, disabled-date
 * predicate, arrow-key day navigation. Replaces the native <input type="date"> for forms
 * that want a consistent, styleable calendar UI instead of the OS/browser's own widget. */
export default function DatePicker({
  value,
  onChange,
  label,
  error,
  hint,
  disabled,
  required,
  size = 'md',
  placeholder = 'Select date…',
  minDate,
  maxDate,
  isDateDisabled,
  wrapperClassName = '',
}: DatePickerProps) {
  const uid = useId();
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : null;
  const [viewDate, setViewDate] = useState(() => selected ?? new Date());
  const [focusedDay, setFocusedDay] = useState<Date>(() => selected ?? new Date());
  const dayRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const { triggerRef, panelRef, style } = usePopoverPosition<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
  });

  const min = minDate ? startOfDay(parseISO(minDate)) : null;
  const max = maxDate ? startOfDay(parseISO(maxDate)) : null;

  function isDisabled(date: Date): boolean {
    const d = startOfDay(date);
    if (min && d < min) return true;
    if (max && d > max) return true;
    return isDateDisabled?.(d) ?? false;
  }

  const weeks = useMemo(() => buildMonthGrid(viewDate), [viewDate]);

  function selectDate(date: Date) {
    if (isDisabled(date)) return;
    onChange(toISO(date));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveFocus(delta: number) {
    const next = new Date(focusedDay);
    next.setDate(next.getDate() + delta);
    setFocusedDay(next);
    if (next.getMonth() !== viewDate.getMonth() || next.getFullYear() !== viewDate.getFullYear()) {
      setViewDate(next);
    }
    requestAnimationFrame(() => dayRefs.current.get(toISO(next))?.focus());
  }

  function handleGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-7);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(7);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectDate(focusedDay);
        break;
    }
  }

  const displayValue = selected
    ? selected.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

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
              aria-label="Choose date"
              style={style}
              className="z-[var(--z-popover)] w-72 rounded-md border border-default bg-surface-overlay p-3 shadow-token-lg"
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                  className="rounded-md p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold text-primary">
                  {viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                  className="rounded-md p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-xs text-secondary">
                {WEEKDAY_LABELS.map((w, i) => (
                  <span key={i} className="py-1 font-medium">
                    {w}
                  </span>
                ))}
              </div>

              <div onKeyDown={handleGridKeyDown}>
                {weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-1">
                    {week.map((date) => {
                      const inMonth = date.getMonth() === viewDate.getMonth();
                      const isSelected = selected ? isSameDay(date, selected) : false;
                      const isToday = isSameDay(date, new Date());
                      const isFocusable = isSameDay(date, focusedDay);
                      const dateDisabled = isDisabled(date);
                      return (
                        <button
                          key={toISO(date)}
                          ref={(node) => {
                            if (node) dayRefs.current.set(toISO(date), node);
                          }}
                          type="button"
                          tabIndex={isFocusable ? 0 : -1}
                          disabled={dateDisabled}
                          aria-current={isToday ? 'date' : undefined}
                          aria-selected={isSelected}
                          onClick={() => selectDate(date)}
                          onFocus={() => setFocusedDay(date)}
                          className={cn(
                            'h-8 w-8 rounded-md text-sm transition-colors duration-150 ease-out',
                            !inMonth && 'text-disabled',
                            inMonth && !isSelected && 'text-primary hover:bg-surface-subtle',
                            isSelected &&
                              'bg-brand text-primary-fg font-semibold hover:bg-primary-hover',
                            isToday && !isSelected && 'border border-focus',
                            dateDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent'
                          )}
                        >
                          {date.getDate()}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-default pt-2">
                <button
                  type="button"
                  onClick={() => selectDate(new Date())}
                  className="rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-primary-subtle"
                >
                  Today
                </button>
                {value && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                    }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                  >
                    Clear
                  </button>
                )}
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
