import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', type, inputMode, pattern, id, ...props }, ref) => {
    const hasError = Boolean(error);
    const numericInput = type === 'number';

    const borderClass = hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-100 dark:border-red-500 dark:focus:ring-red-900/30'
      : 'border-slate-300 focus:border-blue-400 focus:ring-blue-100 dark:border-slate-600 dark:focus:border-blue-400 dark:focus:ring-blue-900/30';

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          type={numericInput ? 'text' : type}
          inputMode={inputMode || (numericInput ? (props.step === '1' ? 'numeric' : 'decimal') : undefined)}
          pattern={pattern || (numericInput ? (props.step === '1' ? '[0-9]*' : '-?[0-9]*\\.?[0-9]*') : undefined)}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined}
          className={[
            'h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 outline-none',
            'transition-colors placeholder:text-slate-400 focus:ring-2',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200',
            'dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500',
            'dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:border-slate-700',
            'read-only:bg-slate-50 dark:read-only:bg-slate-800',
            borderClass,
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        />
        {hasError && (
          <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {helperText && !hasError && (
          <p id={`${id}-helper`} className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
