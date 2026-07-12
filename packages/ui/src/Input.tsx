import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, ICON_SIZE_BY_INPUT_SIZE, type InputVariants } from './inputVariants.js';

export interface InputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'>,
    Pick<InputVariants, 'size' | 'variant'> {
  label?: string | undefined;
  error?: string | undefined;
  success?: string | undefined;
  warning?: string | undefined;
  hint?: string | undefined;
  wrapperClassName?: string;
  /** @deprecated use rightIcon (kept for the ~60 existing call sites that pass this) */
  rightElement?: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Non-interactive addon rendered flush inside the left edge (e.g. a currency symbol). */
  prefix?: ReactNode;
  loading?: boolean;
  clearable?: boolean;
  onClear?: () => void;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      success,
      warning,
      hint,
      wrapperClassName = '',
      className = '',
      rightElement,
      leftIcon,
      rightIcon,
      prefix,
      loading,
      clearable,
      onClear,
      size = 'md',
      variant = 'default',
      id: externalId,
      value,
      disabled,
      required,
      ...rest
    },
    ref
  ) => {
    const uid = useId();
    const inputId = externalId ?? uid;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const state: NonNullable<InputVariants['state']> = error
      ? 'error'
      : warning
        ? 'warning'
        : success
          ? 'success'
          : 'default';
    const message = error ?? warning ?? success ?? hint;
    const messageId = error ? errorId : hint || success || warning ? hintId : undefined;
    const iconSize = ICON_SIZE_BY_INPUT_SIZE[size ?? 'md'];
    const showClear =
      clearable && !disabled && !loading && Boolean(value) && String(value).length > 0;
    const hasLeftAddon = Boolean(leftIcon || prefix);
    const hasRightAddon = Boolean(rightIcon || rightElement || loading || showClear);

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

        <div className="relative flex items-center">
          {hasLeftAddon && (
            <span className="pointer-events-none absolute left-3.5 flex items-center text-secondary [&>svg]:shrink-0">
              {leftIcon ?? prefix}
            </span>
          )}

          <input
            {...rest}
            ref={ref}
            id={inputId}
            value={value}
            disabled={disabled}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={messageId}
            className={cn(
              inputVariants({ size, variant, state }),
              hasLeftAddon && (size === 'sm' ? 'pl-9' : size === 'xl' ? 'pl-12' : 'pl-10'),
              hasRightAddon && (size === 'sm' ? 'pr-9' : size === 'xl' ? 'pr-12' : 'pr-10'),
              className
            )}
          />

          {hasRightAddon && (
            <span className="absolute right-3.5 flex items-center gap-1 text-secondary">
              {loading && <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" />}
              {!loading && showClear && (
                <button
                  type="button"
                  onClick={onClear}
                  aria-label="Clear"
                  className="rounded-md p-0.5 text-secondary transition-colors hover:bg-surface-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <X size={iconSize} />
                </button>
              )}
              {!loading && !showClear && (rightIcon ?? rightElement)}
            </span>
          )}
        </div>

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
    );
  }
);

Input.displayName = 'Input';
export default Input;
