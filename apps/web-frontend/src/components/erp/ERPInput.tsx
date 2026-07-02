import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  wrapperClassName?: string;
}

const ERPInput = forwardRef<HTMLInputElement, Props>(
  ({ error, prefix, suffix, wrapperClassName = '', className = '', id, ...rest }, ref) => {
    const hasAddon = Boolean(prefix || suffix);
    const errorId = id ? `${id}-error` : undefined;

    const inputClass = [
      'w-full bg-surface-card text-primary placeholder:text-disabled',
      'border border-default rounded-lg px-3 py-2 text-sm',
      'outline-none ring-0 transition-colors',
      'focus:border-brand focus:ring-2 focus:ring-brand/20',
      'disabled:bg-surface-subtle disabled:text-secondary disabled:cursor-not-allowed',
      error ? 'border-danger focus:border-danger focus:ring-danger/20' : '',
      hasAddon ? (prefix ? 'rounded-l-none' : 'rounded-r-none') : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    if (!hasAddon) {
      return (
        <input
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error && errorId ? errorId : undefined}
          className={inputClass}
          {...rest}
        />
      );
    }

    return (
      <div className={`flex ${wrapperClassName}`}>
        {prefix && (
          <span className="inline-flex items-center px-3 bg-surface-subtle border border-r-0 border-default rounded-l-lg text-secondary text-sm shrink-0">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error && errorId ? errorId : undefined}
          className={inputClass}
          {...rest}
        />
        {suffix && (
          <span className="inline-flex items-center px-3 bg-surface-subtle border border-l-0 border-default rounded-r-lg text-secondary text-sm shrink-0">
            {suffix}
          </span>
        )}
      </div>
    );
  }
);

ERPInput.displayName = 'ERPInput';
export default ERPInput;
