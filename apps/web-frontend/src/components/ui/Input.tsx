import { InputHTMLAttributes, forwardRef, ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | undefined;
  hint?: string | undefined;
  wrapperClassName?: string;
  rightElement?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, className = '', wrapperClassName = '', rightElement, id, placeholder, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className={`flex flex-col gap-1 ${wrapperClassName}`}>
        <div className="relative">
          <input
            {...rest}
            id={inputId}
            ref={ref}
            placeholder={label ? ' ' : placeholder}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            aria-invalid={!!error}
            className={`peer w-full px-3 text-sm rounded-lg border transition-colors
              bg-surface-card text-primary
              ${label ? 'pt-4 pb-1.5 placeholder-transparent' : 'py-2 placeholder:text-placeholder'}
              ${error
                ? 'border-error focus:border-error focus:ring-2 focus:ring-inset focus:ring-danger'
                : 'border-default hover:border-strong focus:border-focus focus:ring-2 focus:ring-inset focus:ring-focus'
              }
              focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${rightElement ? 'pr-10' : ''} ${className}`}
          />
          {label && (
            <label
              htmlFor={inputId}
              className={`absolute left-3 -mx-1 px-1 bg-surface-card transition-all pointer-events-none
                top-0 -translate-y-1/2 text-xs
                peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-placeholder-shown:text-placeholder
                peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:text-xs
                ${error ? 'text-danger' : 'text-secondary peer-focus:text-brand'}`}
            >
              {label}
              {rest.required && <span className="text-danger ml-0.5">*</span>}
            </label>
          )}
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

Input.displayName = 'Input';
export default Input;
