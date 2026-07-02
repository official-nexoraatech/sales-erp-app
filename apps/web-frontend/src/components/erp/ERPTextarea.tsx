import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const ERPTextarea = forwardRef<HTMLTextAreaElement, Props>(
  ({ label, error, hint, id: externalId, className = '', required, ...rest }, ref) => {
    const uid = useId();
    const inputId = externalId ?? uid;
    const errId = `${uid}-err`;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-primary">
            {label}
            {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          rows={rest.rows ?? 3}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errId : undefined}
          className={[
            'w-full bg-surface-card text-primary placeholder:text-placeholder',
            'border border-default rounded-lg px-3 py-2.5 text-sm resize-y',
            'outline-none transition-colors',
            'focus:border-focus focus:ring-2 focus:ring-brand/20',
            'disabled:bg-surface-subtle disabled:text-secondary disabled:cursor-not-allowed',
            error ? 'border-error focus:border-error focus:ring-danger/20' : '',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
        {error && <p id={errId} className="text-xs text-danger" role="alert">{error}</p>}
        {!error && hint && <p className="text-xs text-secondary">{hint}</p>}
      </div>
    );
  }
);

ERPTextarea.displayName = 'ERPTextarea';
export default ERPTextarea;
