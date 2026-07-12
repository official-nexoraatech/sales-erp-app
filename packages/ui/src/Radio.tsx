import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from './cn.js';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  description?: string;
}

const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ label, description, disabled, id: externalId, className = '', ...rest }, ref) => {
    const uid = useId();
    const id = externalId ?? uid;
    const descId = description ? `${id}-desc` : undefined;

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
            ref={ref}
            type="radio"
            id={id}
            disabled={disabled}
            aria-describedby={descId}
            className={cn(
              'peer h-4.5 w-4.5 appearance-none rounded-full border border-strong bg-surface-card transition-colors duration-150 ease-out',
              'checked:border-[5px] checked:border-brand',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              'disabled:cursor-not-allowed',
              className
            )}
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

Radio.displayName = 'Radio';
export default Radio;
