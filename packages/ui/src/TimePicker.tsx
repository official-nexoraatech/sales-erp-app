import { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, type InputVariants } from './inputVariants.js';
import { usePopoverPosition } from './usePopoverPosition.js';

export interface TimePickerProps {
  /** 24-hour 'HH:MM'. */
  value: string | null;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  size?: InputVariants['size'];
  placeholder?: string;
  /** Minute-column step. Defaults to 5 — exact-minute precision is rarely needed by hand
   * and a 60-row list is a much worse scrolling experience than 12 rows. */
  minuteStep?: number;
  wrapperClassName?: string;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);

function parse(value: string | null): { hour24: number; minute: number } | null {
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  return { hour24: h ?? 0, minute: m ?? 0 };
}

function to24Hour(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const hour24 = period === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function format12(hour24: number): { hour12: number; period: 'AM' | 'PM' } {
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, period };
}

/** Popover time picker with hour/minute/AM-PM columns — replaces the native
 * <input type="time"> for a consistent, styleable widget across browsers. */
export default function TimePicker({
  value,
  onChange,
  label,
  error,
  hint,
  disabled,
  required,
  size = 'md',
  placeholder = 'Select time…',
  minuteStep = 5,
  wrapperClassName = '',
}: TimePickerProps) {
  const uid = useId();
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;
  const [open, setOpen] = useState(false);
  const parsed = parse(value);
  const current = parsed ? format12(parsed.hour24) : null;

  const { triggerRef, panelRef, style } = usePopoverPosition<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
  });

  const minutes = useMemo(
    () => Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep),
    [minuteStep]
  );

  function select(hour12: number, minute: number, period: 'AM' | 'PM') {
    onChange(to24Hour(hour12, minute, period));
  }

  const displayValue = parsed
    ? `${String(current!.hour12).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${current!.period}`
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
          <Clock size={16} className="shrink-0 text-secondary" aria-hidden="true" />
        </button>

        {open &&
          createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Choose time"
              style={style}
              className="z-[var(--z-popover)] flex w-48 gap-1 rounded-md border border-default bg-surface-overlay p-2 shadow-token-lg"
            >
              {(['hour', 'minute', 'period'] as const).map((col) => (
                <div key={col} className="max-h-48 flex-1 overflow-y-auto">
                  {col === 'hour' &&
                    HOURS_12.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => select(h, parsed?.minute ?? 0, current?.period ?? 'AM')}
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-center text-sm transition-colors duration-150 ease-out',
                          current?.hour12 === h
                            ? 'bg-brand text-primary-fg font-semibold'
                            : 'text-primary hover:bg-surface-subtle'
                        )}
                      >
                        {String(h).padStart(2, '0')}
                      </button>
                    ))}
                  {col === 'minute' &&
                    minutes.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => select(current?.hour12 ?? 12, m, current?.period ?? 'AM')}
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-center text-sm transition-colors duration-150 ease-out',
                          parsed?.minute === m
                            ? 'bg-brand text-primary-fg font-semibold'
                            : 'text-primary hover:bg-surface-subtle'
                        )}
                      >
                        {String(m).padStart(2, '0')}
                      </button>
                    ))}
                  {col === 'period' &&
                    (['AM', 'PM'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => select(current?.hour12 ?? 12, parsed?.minute ?? 0, p)}
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-center text-sm transition-colors duration-150 ease-out',
                          current?.period === p
                            ? 'bg-brand text-primary-fg font-semibold'
                            : 'text-primary hover:bg-surface-subtle'
                        )}
                      >
                        {p}
                      </button>
                    ))}
                </div>
              ))}
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
