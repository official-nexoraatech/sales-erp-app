import { SelectHTMLAttributes, forwardRef } from 'react';

interface OptionItem {
  value: string | number;
  label: string;
}

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string | undefined;
  hint?: string | undefined;
  options?: OptionItem[];
  wrapperClassName?: string;
}

const Select = forwardRef<HTMLSelectElement, Props>(
  ({ label, error, hint, options, className = '', wrapperClassName = '', id, children, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className={`flex flex-col gap-1 ${wrapperClassName}`}>
        <div className="relative">
          <select
            {...rest}
            id={inputId}
            ref={ref}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            aria-invalid={!!error}
            className={`peer w-full px-3 text-sm rounded-lg border transition-colors
              bg-surface-card text-primary
              ${label ? 'pt-4 pb-1.5' : 'py-2'}
              ${error
                ? 'border-error focus:border-error focus:ring-2 focus:ring-inset focus:ring-danger'
                : 'border-default hover:border-strong focus:border-focus focus:ring-2 focus:ring-inset focus:ring-focus'
              }
              focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
          >
            {options
              ? options.map((opt) => (
                  <option key={String(opt.value)} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          {label && (
            <label
              htmlFor={inputId}
              className={`absolute left-3 -mx-1 px-1 top-0 -translate-y-1/2 bg-surface-card text-xs transition-colors pointer-events-none
                ${error ? 'text-danger' : 'text-secondary peer-focus:text-brand'}`}
            >
              {label}
              {rest.required && <span className="text-danger ml-0.5">*</span>}
            </label>
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

Select.displayName = 'Select';
export default Select;
