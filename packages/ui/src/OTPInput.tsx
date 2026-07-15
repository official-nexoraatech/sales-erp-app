import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from './cn.js';

export interface OTPInputProps {
  /** Number of digit boxes. */
  length?: number;
  value: string;
  onChange: (value: string) => void;
  /** Fired once the code reaches `length` digits (e.g. to auto-submit). */
  onComplete?: (value: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  wrapperClassName?: string;
}

/** Segmented numeric code input (2FA/TOTP-style) — arrow-key navigation, backspace moves
 * to the previous box, and pasting a full code splits it across all boxes at once. */
export default function OTPInput({
  length = 6,
  value,
  onChange,
  onComplete,
  label,
  error,
  hint,
  disabled,
  autoFocus,
  wrapperClassName = '',
}: OTPInputProps) {
  const uid = useId();
  const errId = `${uid}-error`;
  const hintId = `${uid}-hint`;
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function setDigit(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    const joined = next.join('');
    onChange(joined);
    if (joined.length === length && !next.includes('')) onComplete?.(joined);
  }

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '').slice(-1);
    setDigit(index, digit);
    if (digit && index < length - 1) boxRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault();
      boxRefs.current[index - 1]?.focus();
      setDigit(index - 1, '');
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      boxRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      boxRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    e.preventDefault();
    const next = digits.slice();
    for (let i = 0; i < pasted.length && index + i < length; i++) {
      next[index + i] = pasted[i]!;
    }
    const joined = next.join('');
    onChange(joined);
    if (joined.length === length && !next.includes('')) onComplete?.(joined);
    const lastFilled = Math.min(index + pasted.length, length) - 1;
    boxRefs.current[lastFilled]?.focus();
  }

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label className="text-sm font-medium text-primary tracking-[-0.01em]">{label}</label>
      )}

      <div
        className="flex gap-2"
        role="group"
        aria-describedby={error ? errId : hint ? hintId : undefined}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(node) => {
              boxRefs.current[i] = node;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${i + 1} of ${length}`}
            aria-invalid={Boolean(error)}
            maxLength={1}
            value={digit}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.target.select()}
            className={cn(
              'h-12 w-11 rounded-md border bg-surface-card text-center text-lg font-semibold text-primary',
              'transition-[color,background-color,border-color,box-shadow] duration-150 ease-out outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-subtle disabled:text-disabled',
              error
                ? 'border-error focus:border-error focus:shadow-[var(--shadow-focus-error)]'
                : 'border-default hover:border-strong focus:border-focus focus:shadow-[var(--shadow-focus)]'
            )}
          />
        ))}
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
