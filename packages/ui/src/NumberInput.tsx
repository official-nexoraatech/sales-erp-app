import { forwardRef, useId } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, type InputVariants } from './inputVariants.js';

export interface NumberInputProps extends Pick<InputVariants, 'size' | 'variant'> {
  id?: string;
  label?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  wrapperClassName?: string;
  className?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  required?: boolean;
}

/** Quantity input: large centered value with +/- steppers, clamped to [min, max]. */
const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      id: externalId,
      label,
      error,
      hint,
      wrapperClassName = '',
      className = '',
      value,
      onChange,
      min = 0,
      max,
      step = 1,
      disabled,
      required,
      size = 'md',
      variant = 'default',
    },
    ref
  ) => {
    const uid = useId();
    const inputId = externalId ?? uid;
    const errId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    const clamp = (n: number) => {
      let v = n;
      if (Number.isFinite(min)) v = Math.max(min, v);
      if (typeof max === 'number') v = Math.min(max, v);
      return v;
    };

    const atMin = typeof min === 'number' && value <= min;
    const atMax = typeof max === 'number' && value >= max;

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-primary tracking-[-0.01em]">
            {label}
            {required && (
              <span className="text-danger ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        <div
          className={cn(
            inputVariants({ size, variant, state: error ? 'error' : 'default' }),
            'flex items-stretch p-0 overflow-hidden'
          )}
        >
          <button
            type="button"
            disabled={disabled || atMin}
            onClick={() => onChange(clamp(value - step))}
            aria-label="Decrease quantity"
            className="flex shrink-0 items-center justify-center px-3 text-secondary transition-colors hover:bg-surface-subtle hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Minus size={16} />
          </button>
          <input
            ref={ref}
            id={inputId}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errId : hint ? hintId : undefined}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange(Number.isNaN(n) ? min : clamp(n));
            }}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              'w-full min-w-0 flex-1 border-0 bg-transparent text-center font-semibold tabular-nums text-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              size === 'xl' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg',
              className
            )}
          />
          <button
            type="button"
            disabled={disabled || atMax}
            onClick={() => onChange(clamp(value + step))}
            aria-label="Increase quantity"
            className="flex shrink-0 items-center justify-center px-3 text-secondary transition-colors hover:bg-surface-subtle hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Plus size={16} />
          </button>
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
);

NumberInput.displayName = 'NumberInput';
export default NumberInput;
