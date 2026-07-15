import { forwardRef, useId, useRef, useEffect, type InputHTMLAttributes } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from './cn.js';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  label?: string;
  description?: string;
  /** Visually dash-filled, for "some but not all children selected" (bulk row selection etc). */
  indeterminate?: boolean;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    { label, description, indeterminate, disabled, id: externalId, className = '', ...rest },
    ref
  ) => {
    const uid = useId();
    const id = externalId ?? uid;
    const descId = description ? `${id}-desc` : undefined;
    const localRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (localRef.current) localRef.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);

    return (
      <label
        htmlFor={id}
        className={cn(
          'inline-flex items-start gap-2.5',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        )}
      >
        <span className="relative mt-0.5 grid shrink-0 place-items-center">
          <input
            {...rest}
            ref={(node) => {
              localRef.current = node;
              if (typeof ref === 'function') ref(node);
              else if (ref) ref.current = node;
            }}
            type="checkbox"
            id={id}
            disabled={disabled}
            aria-describedby={descId}
            className={cn(
              'peer h-5 w-5 appearance-none rounded-md border border-strong bg-surface-card transition-colors duration-150 ease-out',
              'checked:border-brand checked:bg-brand indeterminate:border-brand indeterminate:bg-brand',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              'disabled:cursor-not-allowed',
              className
            )}
          />
          <Check
            size={12}
            strokeWidth={3}
            className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
          />
          <Minus
            size={12}
            strokeWidth={3}
            className="pointer-events-none absolute text-white opacity-0 peer-indeterminate:opacity-100"
          />
        </span>
        {(label || description) && (
          <span>
            {label && (
              <span className="block text-sm font-medium leading-tight text-primary">{label}</span>
            )}
            {description && (
              <span id={descId} className="mt-0.5 block text-xs text-secondary">
                {description}
              </span>
            )}
          </span>
        )}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
export default Checkbox;
