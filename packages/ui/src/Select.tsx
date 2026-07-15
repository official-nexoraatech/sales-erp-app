import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn.js';
import { inputVariants, type InputVariants } from './inputVariants.js';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>,
    Pick<InputVariants, 'size' | 'variant'> {
  label?: string | undefined;
  error?: string | undefined;
  success?: string | undefined;
  warning?: string | undefined;
  hint?: string | undefined;
  options?: SelectOption[];
  placeholder?: string;
  wrapperClassName?: string;
  /** Rendered instead of `options` — kept for the call sites that build <option> lists inline. */
  children?: ReactNode;
}

/**
 * A native <select>, restyled. Deliberately NOT a custom listbox: this app's forms bind it
 * via react-hook-form's `{...register('field')}`, which needs a real, form-associated <select>
 * DOM node — a div-based listbox would silently break every one of those ~50 call sites.
 * For a fully custom, searchable dropdown (checkmarks, floating panel, no native chrome),
 * use Combobox instead.
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      success,
      warning,
      hint,
      options,
      placeholder,
      wrapperClassName = '',
      className = '',
      size = 'md',
      variant = 'default',
      id: externalId,
      required,
      children,
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
    const messageId = error ? errorId : message ? hintId : undefined;

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

        <div className="relative">
          <select
            {...rest}
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={messageId}
            className={cn(
              inputVariants({ size, variant, state }),
              'appearance-none pr-10 cursor-pointer',
              className
            )}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-secondary"
          />
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

Select.displayName = 'Select';
export default Select;
