import { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, type InputVariants } from './inputVariants.js';
import { usePopoverPosition } from './usePopoverPosition.js';
import {
  toISODate,
  parseISODate,
  isSameDay,
  buildMonthGrid,
  WEEKDAY_LABELS,
} from './dateGridUtils.js';

export interface DateTimePickerProps {
  /** ISO-ish 'YYYY-MM-DDTHH:MM'. */
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

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function parse(value: string | null): { date: Date; hour24: number; minute: number } | null {
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  if (!datePart) return null;
  const date = parseISODate(datePart);
  const [h, m] = (timePart ?? '00:00').split(':').map(Number);
  return { date, hour24: h ?? 0, minute: m ?? 0 };
}

function format12(hour24: number): { hour12: number; period: 'AM' | 'PM' } {
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, period };
}

function to24Hour(hour12: number, period: 'AM' | 'PM'): number {
  return period === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
}

/** Composes a calendar-grid date picker with hour/minute/AM-PM columns in a single
 * popover — a separate component from DatePicker+TimePicker (rather than nesting two
 * independent popovers) since date and time here are one atomic value with one commit
 * step ("Done"), not two independently-closing pickers. */
export default function DateTimePicker({
  value,
  onChange,
  label,
  error,
  hint,
  disabled,
  required,
  size = 'md',
  placeholder = 'Select date & time…',
  wrapperClassName = '',
}: DateTimePickerProps) {
  const uid = useId();
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;
  const [open, setOpen] = useState(false);
  const parsed = parse(value);
  const [viewDate, setViewDate] = useState(() => parsed?.date ?? new Date());
  const [draftDate, setDraftDate] = useState<Date>(() => parsed?.date ?? new Date());
  const [draftHour24, setDraftHour24] = useState(() => parsed?.hour24 ?? 9);
  const [draftMinute, setDraftMinute] = useState(() => parsed?.minute ?? 0);

  const { triggerRef, panelRef, style } = usePopoverPosition<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
  });

  const weeks = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const draft12 = format12(draftHour24);

  function commit() {
    const iso = `${toISODate(draftDate)}T${String(draftHour24).padStart(2, '0')}:${String(draftMinute).padStart(2, '0')}`;
    onChange(iso);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const displayValue = parsed
    ? `${parsed.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}, ${String(format12(parsed.hour24).hour12).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${format12(parsed.hour24).period}`
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
          onClick={() => {
            if (!open && parsed) {
              setDraftDate(parsed.date);
              setDraftHour24(parsed.hour24);
              setDraftMinute(parsed.minute);
            }
            setOpen((o) => !o);
          }}
          className={cn(
            inputVariants({ size, variant: 'default', state: error ? 'error' : 'default' }),
            'flex items-center justify-between text-left',
            !displayValue && 'text-placeholder'
          )}
        >
          <span className="truncate">{displayValue || placeholder}</span>
          <CalendarClock size={16} className="shrink-0 text-secondary" aria-hidden="true" />
        </button>

        {open &&
          createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Choose date and time"
              style={style}
              className="z-[var(--z-popover)] w-80 rounded-md border border-default bg-surface-overlay p-3 shadow-token-lg"
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                  className="rounded-md px-2 py-1 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                >
                  ‹
                </button>
                <span className="text-sm font-semibold text-primary">
                  {viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                  className="rounded-md px-2 py-1 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                >
                  ›
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-xs text-secondary">
                {WEEKDAY_LABELS.map((w, i) => (
                  <span key={i} className="py-1 font-medium">
                    {w}
                  </span>
                ))}
              </div>
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map((date) => {
                    const inMonth = date.getMonth() === viewDate.getMonth();
                    const isSelected = isSameDay(date, draftDate);
                    return (
                      <button
                        key={toISODate(date)}
                        type="button"
                        onClick={() => setDraftDate(date)}
                        className={cn(
                          'h-7 w-7 rounded-md text-xs transition-colors duration-150 ease-out',
                          !inMonth && 'text-disabled',
                          inMonth && !isSelected && 'text-primary hover:bg-surface-subtle',
                          isSelected &&
                            'bg-brand text-primary-fg font-semibold hover:bg-primary-hover'
                        )}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>
              ))}

              <div className="mt-3 flex items-center justify-center gap-1 border-t border-default pt-3">
                <div className="max-h-32 w-14 overflow-y-auto">
                  {HOURS_12.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setDraftHour24(to24Hour(h, draft12.period))}
                      className={cn(
                        'w-full rounded-md px-2 py-1 text-center text-sm transition-colors duration-150 ease-out',
                        draft12.hour12 === h
                          ? 'bg-brand text-primary-fg font-semibold'
                          : 'text-primary hover:bg-surface-subtle'
                      )}
                    >
                      {String(h).padStart(2, '0')}
                    </button>
                  ))}
                </div>
                <span className="text-secondary">:</span>
                <div className="max-h-32 w-14 overflow-y-auto">
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraftMinute(m)}
                      className={cn(
                        'w-full rounded-md px-2 py-1 text-center text-sm transition-colors duration-150 ease-out',
                        draftMinute === m
                          ? 'bg-brand text-primary-fg font-semibold'
                          : 'text-primary hover:bg-surface-subtle'
                      )}
                    >
                      {String(m).padStart(2, '0')}
                    </button>
                  ))}
                </div>
                <div className="flex w-12 flex-col gap-1">
                  {(['AM', 'PM'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDraftHour24(to24Hour(draft12.hour12, p))}
                      className={cn(
                        'rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 ease-out',
                        draft12.period === p
                          ? 'bg-brand text-primary-fg'
                          : 'text-secondary hover:bg-surface-subtle'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex justify-end gap-2 border-t border-default pt-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={commit}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-primary-fg transition-colors hover:bg-primary-hover"
                >
                  Done
                </button>
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
