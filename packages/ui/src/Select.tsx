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
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            className={cn(
              inputVariants({ size, variant, state: error ? 'error' : 'default' }),
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

        {error && (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={hintId} className="text-xs text-secondary">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
