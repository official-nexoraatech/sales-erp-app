import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn.js';
import { inputVariants, type InputVariants } from './inputVariants.js';

export interface TextareaProps
  extends
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    Pick<InputVariants, 'size' | 'variant'> {
  label?: string | undefined;
  error?: string | undefined;
  success?: string | undefined;
  warning?: string | undefined;
  hint?: string | undefined;
  wrapperClassName?: string;
  maxLength?: number;
  showCount?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      success,
      warning,
      hint,
      wrapperClassName = '',
      className = '',
      size = 'md',
      variant = 'default',
      id: externalId,
      required,
      rows = 3,
      maxLength,
      showCount,
      value,
      ...rest
    },
    ref
  ) => {
    const uid = useId();
    const inputId = externalId ?? uid;
    const errId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const count = typeof value === 'string' ? value.length : undefined;
    const state: NonNullable<InputVariants['state']> = error
      ? 'error'
      : warning
        ? 'warning'
        : success
          ? 'success'
          : 'default';
    const message = error ?? warning ?? success ?? hint;
    const messageId = error ? errId : message ? hintId : undefined;

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

        <textarea
          {...rest}
          ref={ref}
          id={inputId}
          rows={rows}
          required={required}
          value={value}
          maxLength={maxLength}
          aria-invalid={Boolean(error)}
          aria-describedby={messageId}
          className={cn(
            inputVariants({ size, variant, state }),
            'h-auto resize-y py-2.5 leading-relaxed',
            className
          )}
        />

        <div className="flex items-start justify-between gap-2">
          <div>
            {message && (
              <p
                id={messageId}
                role={error ? 'alert' : undefined}
                className={cn(
                  'text-xs',
                  error && 'text-danger',
                  warning && !error && 'text-warning',
                  success && !error && !warning && 'text-success',
                  !error && !warning && !success && 'text-secondary'
                )}
              >
                {message}
              </p>
            )}
          </div>
          {showCount && maxLength && (
            <p className="shrink-0 text-xs text-secondary tabular-nums">
              {count ?? 0}/{maxLength}
            </p>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
export default Textarea;
