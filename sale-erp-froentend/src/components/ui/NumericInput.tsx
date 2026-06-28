import React, { useEffect, useId, useState } from 'react';

type NumericInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode' | 'min' | 'max'
> & {
  value: number | string;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  emptyValue?: number;
  error?: string;
  helperText?: string;
  containerClassName?: string;
};

const toDisplayValue = (value: number | string) =>
  value === null || value === undefined ? '' : String(value);

const parseNumericText = (
  value: string,
  { integer, min, max }: Pick<NumericInputProps, 'integer' | 'min' | 'max'>,
) => {
  const text = value.trim();
  const pattern = integer ? /^-?\d+$/ : /^-?(?:\d+|\d*\.\d+)$/;

  if (!pattern.test(text)) {
    return {
      message: integer ? 'Enter a valid whole number' : 'Enter a valid number',
      value: null,
    };
  }

  const numericValue = Number(text);
  if (!Number.isFinite(numericValue)) {
    return { message: 'Enter a valid number', value: null };
  }
  if (min !== undefined && numericValue < min) {
    return {
      message: min === 0 ? 'Value cannot be negative' : `Value must be at least ${min}`,
      value: null,
    };
  }
  if (max !== undefined && numericValue > max) {
    return { message: `Value must be ${max} or less`, value: null };
  }

  return { message: '', value: numericValue };
};

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  (
    {
      value,
      onValueChange,
      min,
      max,
      integer = false,
      emptyValue = 0,
      error,
      helperText,
      containerClassName,
      className = '',
      id,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const [displayValue, setDisplayValue] = useState(toDisplayValue(value));
    const [validationError, setValidationError] = useState('');
    const message = error || validationError;

    useEffect(() => {
      setDisplayValue(toDisplayValue(value));
      setValidationError('');
    }, [value]);

    return (
      <div className={containerClassName || 'w-full'}>
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          value={displayValue}
          aria-invalid={Boolean(message) || undefined}
          aria-describedby={message || helperText ? `${inputId}-message` : undefined}
          className={[
            'h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 outline-none',
            'transition-colors placeholder:text-slate-400 focus:ring-2',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
            'dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500',
            'dark:disabled:bg-slate-800 dark:disabled:text-slate-500',
            message
              ? 'border-red-400 focus:border-red-500 focus:ring-red-100 dark:border-red-500 dark:focus:ring-red-900/30'
              : 'border-slate-300 focus:border-blue-400 focus:ring-blue-100 dark:border-slate-600 dark:focus:border-blue-400 dark:focus:ring-blue-900/30',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDisplayValue(nextValue);

            if (nextValue.trim() === '') {
              setValidationError('');
              onValueChange(emptyValue);
              return;
            }

            const result = parseNumericText(nextValue, { integer, min, max });
            setValidationError(result.message);
            if (result.value !== null) onValueChange(result.value);
          }}
          {...props}
        />
        {message && (
          <p id={`${inputId}-message`} role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
            {message}
          </p>
        )}
        {helperText && !message && (
          <p id={`${inputId}-message`} className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

NumericInput.displayName = 'NumericInput';
