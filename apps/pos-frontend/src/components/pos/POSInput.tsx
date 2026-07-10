import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | undefined;
  hint?: string | undefined;
  wrapperClassName?: string;
  rightElement?: ReactNode;
}

const POSInput = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, className = '', wrapperClassName = '', rightElement, id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className={`flex flex-col gap-1 ${wrapperClassName}`}>
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-primary">
            {label}
            {rest.required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            {...rest}
            id={inputId}
            ref={ref}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            aria-invalid={!!error}
            className={`w-full min-h-[44px] px-3 py-2 text-base rounded-xl border transition-colors
              bg-surface-card text-primary
              placeholder:text-placeholder
              ${error
                ? 'border-error focus:ring-2 focus:ring-offset-0 focus:ring-danger focus:border-error'
                : 'border-default hover:border-strong focus:ring-2 focus:ring-offset-0 focus:ring-border-focus focus:border-focus'
              }
              focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${rightElement ? 'pr-10' : ''} ${className}`}
          />
          {rightElement && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-2">{rightElement}</div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-danger">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="text-xs text-secondary">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

POSInput.displayName = 'POSInput';
export default POSInput;
